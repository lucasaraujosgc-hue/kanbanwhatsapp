import express from 'express';
import { createServer as createViteServer } from 'vite';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import pkg, { type Client as WAClient } from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DATA_DIR = process.env.DATA_DIR || '/backup';
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn(`Could not create ${DATA_DIR}, falling back to local data directory`);
  DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const AI_DATA_DIR = '/app/wp';
try {
  if (!fs.existsSync(AI_DATA_DIR)) fs.mkdirSync(AI_DATA_DIR, { recursive: true });
} catch (e) {
  console.warn(`Could not create ${AI_DATA_DIR}`);
}

const MEDIA_DIR = path.join(DATA_DIR, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const upload = multer({ dest: MEDIA_DIR });

const db = new sqlite3.Database(path.join(DATA_DIR, 'kanban.db'));
const aiDb = new sqlite3.Database(path.join(AI_DATA_DIR, 'ai_memory.db'));

// ─────────────────────────────────────────────────────────────
// HELPER: always prefer @c.us. Receives any JID or phone string
// and returns a clean "phone@c.us" whenever the number is ≤ 15
// digits (standard E.164). LIDs (> 15 digits) are returned as-is
// with @lid ONLY when we truly have no phone number.
// ─────────────────────────────────────────────────────────────
function buildChatId(phone: string | null | undefined, fallbackJid: string): string {
  if (phone) {
    const clean = phone.replace(/\D/g, '');
    if (clean.length > 0 && clean.length <= 15) {
      return `${clean}@c.us`;
    }
  }
  // fallback: if the JID already is @c.us, keep it; otherwise keep @lid
  return fallbackJid;
}

// Extract the numeric part from any JID
function jidToPhone(jid: string): string {
  return jid.split('@')[0].replace(/\D/g, '');
}

// Try to resolve a @lid contact to a real phone via Puppeteer Store
async function resolveLidToPhone(waClient: WAClient, lidJid: string): Promise<string | null> {
  try {
    const result = await waClient.pupPage.evaluate(async (lid: string) => {
      try {
        const w = window as any;
        const lidNumber = lid.split('@')[0];
        const fullLid = `${lidNumber}@lid`;

        if (!w.Store || !w.Store.Contact) return null;

        const contacts = w.Store.Contact.getModelsArray();

        // 1. Direct lidJid match pointing to a c.us contact
        const direct = contacts.find((c: any) =>
          c.id && c.id.server === 'c.us' && (c.lidJid === fullLid || c.lidJid === lidNumber)
        );
        if (direct?.id?.user) return direct.id.user;

        // 2. Fuzzy: any c.us contact whose properties reference the lid number
        const fuzzy = contacts.find((c: any) => {
          if (!c.id || c.id.server !== 'c.us') return false;
          for (const key in c) {
            const val = c[key];
            if (typeof val === 'string' && val.includes(lidNumber)) return true;
            if (val && typeof val === 'object' && val.user === lidNumber) return true;
          }
          return false;
        });
        if (fuzzy?.id?.user) return fuzzy.id.user;

        // 3. Fetch the lid contact itself and look for a c.us reference
        const lidContact = w.Store.Contact.get(fullLid);
        if (lidContact) {
          if (lidContact.phoneNumber) return lidContact.phoneNumber.split('@')[0];
          for (const key in lidContact) {
            const val = lidContact[key];
            if (typeof val === 'string' && val.includes('@c.us')) return val.split('@')[0];
          }
        }
      } catch (_) {}
      return null;
    }, lidJid);

    return result || null;
  } catch (_) {
    return null;
  }
}

// Initialize AI Database
aiDb.serialize(() => {
  aiDb.run(`CREATE TABLE IF NOT EXISTS ai_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    created_at INTEGER
  )`);
  aiDb.run(`ALTER TABLE ai_memory ADD COLUMN trigger_at INTEGER`, () => {});
  aiDb.run(`ALTER TABLE ai_memory ADD COLUMN is_triggered INTEGER DEFAULT 0`, () => {});

  aiDb.run(`CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    message TEXT,
    trigger_at INTEGER,
    is_triggered INTEGER DEFAULT 0,
    created_at INTEGER
  )`);
});

// Initialize Database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    color TEXT DEFAULT '#e2e8f0'
  )`);
  db.run(`ALTER TABLE columns ADD COLUMN color TEXT DEFAULT '#e2e8f0'`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    column_id TEXT,
    last_message TEXT,
    last_message_time INTEGER,
    unread_count INTEGER DEFAULT 0,
    profile_pic TEXT,
    last_message_from_me INTEGER DEFAULT 0
  )`);
  db.run(`ALTER TABLE chats ADD COLUMN profile_pic TEXT`, () => {});
  db.run(`ALTER TABLE chats ADD COLUMN last_message_from_me INTEGER DEFAULT 0`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_tags (
    chat_id TEXT,
    tag_id TEXT,
    PRIMARY KEY (chat_id, tag_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ai_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    body TEXT,
    from_me INTEGER,
    timestamp INTEGER,
    media_url TEXT,
    media_type TEXT,
    media_name TEXT,
    transcription TEXT
  )`);
  db.run(`ALTER TABLE messages ADD COLUMN media_url TEXT`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN media_type TEXT`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN media_name TEXT`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN transcription TEXT`, () => {});

  // ── Startup migration: normalize any non-standard IDs to @c.us ──
  db.all("SELECT * FROM chats WHERE id NOT LIKE '%@%'", (err, rows: any[]) => {
    if (err) return;
    if (!rows || rows.length === 0) return;
    rows.forEach(row => {
      if (row.id === '0' || row.id === 'status@broadcast') return;
      const cleanPhone = String(row.phone || row.id).replace(/\D/g, '');
      if (!cleanPhone) return;
      const newId = cleanPhone.length <= 15 ? `${cleanPhone}@c.us` : `${cleanPhone}@lid`;
      db.get("SELECT id FROM chats WHERE id = ?", [newId], (err, existing) => {
        if (existing) {
          db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [newId, row.id]);
          db.run("UPDATE OR IGNORE chat_tags SET chat_id = ? WHERE chat_id = ?", [newId, row.id]);
          db.run("DELETE FROM chats WHERE id = ?", [row.id]);
        } else {
          db.run(
            "INSERT OR REPLACE INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count, profile_pic, last_message_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, row.name, cleanPhone, row.column_id, row.last_message, row.last_message_time, row.unread_count, row.profile_pic, row.last_message_from_me],
            () => {
              db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [newId, row.id]);
              db.run("UPDATE OR IGNORE chat_tags SET chat_id = ? WHERE chat_id = ?", [newId, row.id]);
              db.run("DELETE FROM chats WHERE id = ?", [row.id]);
            }
          );
        }
      });
    });
  });

  // Cleanup corrupted rows
  db.run("DELETE FROM messages WHERE chat_id = '0@c.us'");
  db.run("DELETE FROM chat_tags WHERE chat_id = '0@c.us'");
  db.run("DELETE FROM chats WHERE id = '0@c.us' OR id = '0' OR phone = '0'");

  // Default columns
  db.get("SELECT COUNT(*) as count FROM columns", (err, row: any) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO columns (id, name, position) VALUES (?, ?, ?)");
      stmt.run('col-1', 'Novos', 0);
      stmt.run('col-2', 'Em Atendimento', 1);
      stmt.run('col-3', 'Aguardando Cliente', 2);
      stmt.run('col-4', 'Finalizados', 3);
      stmt.finalize();
    }
  });
});

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

  app.use(cors());
  app.use(express.json());
  app.use('/media', express.static(MEDIA_DIR));

  const checkPassword = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const appPassword = process.env.PASSWORD;
    if (!appPassword) return next();
    if (req.path.startsWith('/api/login')) return next();
    const clientPassword = req.headers['x-app-password'];
    if (clientPassword === appPassword) next();
    else res.status(401).json({ error: 'Unauthorized' });
  };

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!process.env.PASSWORD || password === process.env.PASSWORD) res.json({ success: true });
    else res.status(401).json({ error: 'Invalid password' });
  });

  app.use('/api', checkPassword);

  // ── Background Jobs ──
  setInterval(() => {
    if (!waClient || waStatus !== 'connected') return;
    const now = Date.now();

    aiDb.all("SELECT * FROM ai_memory WHERE trigger_at IS NOT NULL AND trigger_at <= ? AND is_triggered = 0", [now], (err, rows) => {
      if (err || !rows || rows.length === 0) return;
      rows.forEach(async (row: any) => {
        try {
          const myPhone = process.env.MY_PHONE;
          if (myPhone) await waClient!.sendMessage(`${myPhone}@c.us`, `⏰ *LEMBRETE*\n\n${row.content}`);
          aiDb.run("UPDATE ai_memory SET is_triggered = 1 WHERE id = ?", [row.id]);
        } catch (e) { console.error('Error sending reminder:', e); }
      });
    });

    aiDb.all("SELECT * FROM scheduled_messages WHERE trigger_at <= ? AND is_triggered = 0", [now], (err, rows) => {
      if (err || !rows || rows.length === 0) return;
      rows.forEach(async (row: any) => {
        try {
          const chatId = `${row.phone}@c.us`;
          await waClient!.sendMessage(chatId, row.message);
          aiDb.run("UPDATE scheduled_messages SET is_triggered = 1 WHERE id = ?", [row.id]);
          const myPhone = process.env.MY_PHONE;
          if (myPhone) await waClient!.sendMessage(`${myPhone}@c.us`, `✅ *MENSAGEM AGENDADA ENVIADA*\n\nPara: ${row.phone}\nMensagem: ${row.message}`);
        } catch (e) { console.error('Error sending scheduled message:', e); }
      });
    });
  }, 60000);

  // ── API Routes ──
  app.post('/api/copilot', async (req, res) => {
    const { message } = req.body;
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ reply: 'A chave da API do Gemini não está configurada.' });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const chats = await new Promise<any[]>((resolve, reject) => {
        db.all(`
          SELECT c.id, c.name, c.phone, c.last_message, c.last_message_time, c.unread_count, col.name as column_name, GROUP_CONCAT(t.name) as tags
          FROM chats c
          LEFT JOIN columns col ON c.column_id = col.id
          LEFT JOIN chat_tags ct ON c.id = ct.chat_id
          LEFT JOIN tags t ON ct.tag_id = t.id
          GROUP BY c.id
        `, (err, rows) => { if (err) reject(err); else resolve(rows); });
      });

      const tags = await new Promise<any[]>((resolve, reject) => {
        db.all("SELECT * FROM tags", (err, rows) => { if (err) reject(err); else resolve(rows); });
      });

      const recentMessages = await new Promise<any[]>((resolve, reject) => {
        db.all(`
          SELECT m.body, m.from_me, m.timestamp, c.name as chat_name
          FROM messages m
          JOIN chats c ON m.chat_id = c.id
          ORDER BY m.timestamp DESC LIMIT 100
        `, (err, rows) => { if (err) reject(err); else resolve(rows); });
      });

      const systemInstruction = `Você deve funcionar como um "copiloto" do dashboard.
Data e hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

==================================================
OBJETIVO PRINCIPAL
Seu objetivo é ajudar o operador humano a:
Consultar dados de mensagens, contatos, tags e kanban
Resumir conversas ou grupos de conversas em lote
Sugerir respostas para clientes
Classificar contextos operacionais
Identificar pendências, urgências e ações sugeridas
Traduzir pedidos em linguagem natural para intenções estruturadas
Apoiar automações, SEM executar ações perigosas sem confirmação
Você NÃO deve inventar dados.
Você NÃO deve assumir que tem acesso direto ao banco.
Você NÃO deve responder como se soubesse números, quantidades ou registros se eles não forem fornecidos pelo sistema.

DADOS FORNECIDOS PELO SISTEMA NESTE MOMENTO:
Tags existentes: ${JSON.stringify(tags)}
Resumo dos Chats atuais: ${JSON.stringify(chats.map(c => ({
  nome: c.name,
  telefone: c.phone,
  coluna: c.column_name,
  tags: c.tags,
  ultima_mensagem: c.last_message,
  data_ultima_mensagem: new Date(c.last_message_time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
})))}
Últimas 100 mensagens (contexto recente): ${JSON.stringify(recentMessages.map(m => ({
  chat: m.chat_name,
  enviado_por_mim: m.from_me === 1,
  mensagem: m.body,
  data: new Date(m.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
})))}

==================================================
COMPORTAMENTO GERAL
Sempre que receber uma solicitação do usuário, você deve identificar qual é o tipo da solicitação.
Os principais tipos são: CONSULTA, RESUMO, AÇÃO, SUGESTÃO DE RESPOSTA, CLASSIFICAÇÃO, FOLLOW-UP, TRIAGEM, COMANDO OPERACIONAL.
Você deve interpretar o pedido do usuário e responder de forma objetiva, útil, operacional e profissional.
Você deve sempre priorizar: clareza, precisão, segurança, economia de tokens, utilidade prática no contexto de escritório contábil.

==================================================
REGRA MAIS IMPORTANTE
VOCÊ NÃO DEVE "ADIVINHAR" RESULTADOS DO SISTEMA.
Se o usuário pedir algo que depende de dados reais do sistema que não estão nos DADOS FORNECIDOS acima, você deve converter isso em uma intenção estruturada (JSON) para o sistema executar.

MODO 1 — INTERPRETAÇÃO DE COMANDO
Quando o usuário fizer uma pergunta ou ordem relacionada a dados do sistema que não estão no contexto, retorne JSON.

MODO 2 — ANÁLISE / RESUMO / RESPOSTA
Quando o sistema já fornecer os dados para análise, responda em linguagem natural útil, clara e operacional.

SEGURANÇA E CONTROLE: Você NUNCA deve executar automaticamente ações críticas sem confirmação explícita.
RESPOSTAS AUTOMÁTICAS: Você NÃO deve recomendar resposta automática livre para temas sensíveis como: cálculo de imposto, interpretação tributária, demissão, rescisão, admissão, multa, enquadramento fiscal, obrigações legais específicas.
ESTILO DE RESPOSTA: profissional, objetivo, claro, operacional, útil para ambiente de escritório contábil, sem floreios desnecessários. Quando precisar destacar uma palavra ou frase, utilize sempre negrito com dois asteriscos (exemplo: **palavra**).

FORMATO DE SAÍDA:
Se o pedido for para executar uma ação (enviar mensagem, criar tag, adicionar tag, agendar mensagem), você DEVE retornar APENAS um JSON no seguinte formato, sem formatação markdown (sem \`\`\`json):
Para enviar mensagem: {"command": "SEND_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem"}}
Para agendar o envio de uma mensagem: {"command": "SCHEDULE_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem", "trigger_at": "2026-05-10T09:00:00"}}
Para criar tag: {"command": "CREATE_TAG", "params": {"name": "Nome da Tag"}}
Para adicionar tag a um contato: {"command": "ADD_TAG", "params": {"phone": "5511999999999", "tag_name": "Nome da Tag"}}
Para adicionar um lembrete/tarefa na memória: {"command": "ADD_MEMORY", "params": {"content": "Lembrar de ligar para o cliente X", "trigger_at": "2026-05-10T09:00:00"}}

Se for pedido de análise de dados já fornecidos: RETORNE TEXTO CLARO E ÚTIL
Se for pedido de sugestão de resposta: RETORNE SOMENTE A SUGESTÃO DE RESPOSTA
Se for pedido de classificação: RETORNE JSON ESTRUTURADO

REGRA FINAL: Você é um assistente operacional de CRM/WhatsApp para contabilidade. Você não é um atendente do cliente final. Você é um copiloto interno do operador do sistema.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: message,
        config: { systemInstruction }
      });

      let replyText = response.text || '';

      try {
        const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
        if (cleanJson.startsWith('{') && cleanJson.endsWith('}')) {
          const cmd = JSON.parse(cleanJson);
          let command = cmd.command || cmd.intent || cmd.acao;
          let params = cmd.params || cmd.parametros || {};

          if (command) {
            if ((command === 'SEND_MESSAGE' || command === 'ENVIAR_MENSAGEM') && waClient && waStatus === 'connected') {
              const phone = (params.phone || params.telefone || '').replace(/\D/g, '');
              const msgText = params.message || params.mensagem;
              await waClient.sendMessage(`${phone}@c.us`, msgText);
              replyText = `✅ Mensagem enviada para ${phone}:\n"${msgText}"`;
            } else if (command === 'SCHEDULE_MESSAGE' || command === 'AGENDAR_MENSAGEM') {
              const phone = (params.phone || params.telefone || '').replace(/\D/g, '');
              const msgText = params.message || params.mensagem;
              const triggerAt = params.trigger_at ? new Date(params.trigger_at).getTime() : null;
              if (triggerAt && phone && msgText) {
                await new Promise((resolve) => {
                  aiDb.run("INSERT INTO scheduled_messages (phone, message, trigger_at, is_triggered, created_at) VALUES (?, ?, ?, ?, ?)",
                    [phone, msgText, triggerAt, 0, Date.now()], resolve);
                });
                replyText = `✅ Mensagem agendada para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\nPara: ${phone}\n"${msgText}"`;
              } else {
                replyText = `❌ Erro ao agendar mensagem. Verifique telefone, mensagem e data/hora.`;
              }
            } else if (command === 'CREATE_TAG' || command === 'CRIAR_TAG') {
              const tagName = params.name || params.nome;
              const tagId = `tag-${Date.now()}`;
              const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
              await new Promise((resolve) => { db.run("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)", [tagId, tagName, color], resolve); });
              io.emit('tags_updated');
              replyText = `✅ Tag "${tagName}" criada com sucesso.`;
            } else if (command === 'ADD_TAG') {
              const phone = (params.phone || params.contact_phone || '').replace(/\D/g, '');
              const tagName = params.tag_name || params.name;
              const chat: any = await new Promise((resolve) => {
                db.get("SELECT id FROM chats WHERE phone = ?", [phone], (err, row) => resolve(row));
              });
              if (chat) {
                const tag: any = await new Promise((resolve) => {
                  db.get("SELECT id FROM tags WHERE name LIKE ?", [`%${tagName}%`], (err, row) => resolve(row));
                });
                if (tag) {
                  await new Promise((resolve) => { db.run("INSERT OR IGNORE INTO chat_tags (chat_id, tag_id) VALUES (?, ?)", [chat.id, tag.id], resolve); });
                  io.emit('chat_updated', { id: chat.id });
                  replyText = `✅ Tag "${tagName}" adicionada ao contato.`;
                } else {
                  replyText = `❌ Tag "${tagName}" não encontrada.`;
                }
              } else {
                replyText = `❌ Contato com telefone ${phone} não encontrado.`;
              }
            } else if (command === 'ADD_MEMORY') {
              const content = params.content || params.conteudo;
              const triggerAt = params.trigger_at ? new Date(params.trigger_at).getTime() : null;
              await new Promise((resolve) => {
                aiDb.run("INSERT INTO ai_memory (content, created_at, trigger_at, is_triggered) VALUES (?, ?, ?, ?)",
                  [content, Date.now(), triggerAt, 0], resolve);
              });
              replyText = triggerAt
                ? `✅ Lembrete agendado para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n"${content}"`
                : `✅ Lembrete/Tarefa adicionada à minha memória:\n"${content}"`;
              const myPhone = process.env.MY_PHONE;
              if (waClient && waStatus === 'connected' && myPhone) {
                await waClient.sendMessage(`${myPhone}@c.us`, `✅ Novo lembrete adicionado via Copiloto:\n"${content}"${triggerAt ? `\nAgendado para: ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`);
              }
            }
          }
        }
      } catch (_) {}

      res.json({ reply: replyText });
    } catch (error) {
      console.error('Copilot error:', error);
      res.status(500).json({ reply: 'Erro ao processar a solicitação no copiloto.' });
    }
  });

  app.get('/api/columns', (req, res) => {
    db.all("SELECT * FROM columns ORDER BY position ASC", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post('/api/columns', (req, res) => {
    const { id, name, position, color } = req.body;
    db.run("INSERT INTO columns (id, name, position, color) VALUES (?, ?, ?, ?)", [id, name, position, color || '#e2e8f0'], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('columns_updated');
      res.json({ success: true });
    });
  });

  app.put('/api/columns/:id', (req, res) => {
    const { name, position, color } = req.body;
    db.run("UPDATE columns SET name = ?, position = ?, color = ? WHERE id = ?", [name, position, color || '#e2e8f0', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('columns_updated');
      res.json({ success: true });
    });
  });

  app.delete('/api/columns/:id', (req, res) => {
    const colId = req.params.id;
    db.get("SELECT id FROM columns WHERE id != ? ORDER BY position ASC LIMIT 1", [colId], (err, row: any) => {
      if (err) return res.status(500).json({ error: err.message });
      const targetColId = row ? row.id : null;
      if (targetColId) {
        db.run("UPDATE chats SET column_id = ? WHERE column_id = ?", [targetColId, colId], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          db.run("DELETE FROM columns WHERE id = ?", [colId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('columns_updated');
            io.emit('chat_updated');
            res.json({ success: true });
          });
        });
      } else {
        res.status(400).json({ error: 'Cannot delete the last column' });
      }
    });
  });

  app.get('/api/chats', (req, res) => {
    db.all(`
      SELECT c.*, GROUP_CONCAT(t.id) as tag_ids
      FROM chats c
      LEFT JOIN chat_tags ct ON c.id = ct.chat_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      GROUP BY c.id
      ORDER BY c.last_message_time DESC
    `, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const formattedRows = rows.map((r: any) => ({ ...r, tag_ids: r.tag_ids ? r.tag_ids.split(',') : [] }));
      res.json(formattedRows);
    });
  });

  app.put('/api/chats/:id/column', (req, res) => {
    const { column_id } = req.body;
    db.run("UPDATE chats SET column_id = ? WHERE id = ?", [column_id, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('chat_updated', { id: req.params.id, column_id });
      res.json({ success: true });
    });
  });

  app.put('/api/chats/:id/name', (req, res) => {
    const { name } = req.body;
    db.run("UPDATE chats SET name = ? WHERE id = ?", [name, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('chat_updated', { id: req.params.id, name });
      res.json({ success: true });
    });
  });

  app.put('/api/chats/:id/read', (req, res) => {
    db.run("UPDATE chats SET unread_count = 0 WHERE id = ?", [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('chat_updated', { id: req.params.id, unread_count: 0 });
      res.json({ success: true });
    });
  });

  app.get('/api/tags', (req, res) => {
    db.all("SELECT * FROM tags", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/ai_memory', (req, res) => {
    aiDb.all("SELECT * FROM ai_memory ORDER BY created_at DESC", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post('/api/ai_memory', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    aiDb.run("INSERT INTO ai_memory (content, created_at) VALUES (?, ?)", [content, Date.now()], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, content, created_at: Date.now() });
    });
  });

  app.delete('/api/ai_memory/:id', (req, res) => {
    aiDb.run("DELETE FROM ai_memory WHERE id = ?", [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  app.post('/api/tags', (req, res) => {
    const { id, name, color } = req.body;
    db.run("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)", [id, name, color], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('tags_updated');
      res.json({ success: true });
    });
  });

  app.put('/api/tags/:id', (req, res) => {
    const { name, color } = req.body;
    db.run("UPDATE tags SET name = ?, color = ? WHERE id = ?", [name, color, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('tags_updated');
      res.json({ success: true });
    });
  });

  app.delete('/api/tags/:id', (req, res) => {
    db.serialize(() => {
      db.run("DELETE FROM chat_tags WHERE tag_id = ?", [req.params.id]);
      db.run("DELETE FROM tags WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('tags_updated');
        res.json({ success: true });
      });
    });
  });

  app.post('/api/chats/:id/tags', (req, res) => {
    const { tag_id } = req.body;
    db.run("INSERT INTO chat_tags (chat_id, tag_id) VALUES (?, ?)", [req.params.id, tag_id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('chat_tags_updated', { chat_id: req.params.id });
      res.json({ success: true });
    });
  });

  app.delete('/api/chats/:id/tags/:tag_id', (req, res) => {
    db.run("DELETE FROM chat_tags WHERE chat_id = ? AND tag_id = ?", [req.params.id, req.params.tag_id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('chat_tags_updated', { chat_id: req.params.id });
      res.json({ success: true });
    });
  });

  app.get('/api/chats/:id/messages', (req, res) => {
    db.all("SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC", [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.get('/api/system/storage', (req, res) => {
    try {
      let totalSize = 0;
      if (fs.existsSync(MEDIA_DIR)) {
        const files = fs.readdirSync(MEDIA_DIR);
        for (const file of files) {
          const stats = fs.statSync(path.join(MEDIA_DIR, file));
          totalSize += stats.size;
        }
      }
      res.json({ total_bytes: totalSize });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/media', (req, res) => {
    db.all(`
      SELECT m.id, m.chat_id, m.media_url, m.media_type, m.media_name, m.timestamp, m.from_me, c.name as chat_name, c.phone as chat_phone
      FROM messages m
      JOIN chats c ON m.chat_id = c.id
      WHERE m.media_url IS NOT NULL
      ORDER BY m.timestamp DESC
    `, (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: err.message });
      const mediaFiles = rows.map(row => {
        let size = 0;
        if (row.media_url) {
          try {
            const filename = row.media_url.replace('/media/', '');
            const stats = fs.statSync(path.join(MEDIA_DIR, filename));
            size = stats.size;
          } catch (_) {}
        }
        return { ...row, size };
      });
      res.json(mediaFiles);
    });
  });

  app.post('/api/chats/:id/messages', upload.single('media'), async (req, res) => {
    const { body } = req.body;
    const chatId = req.params.id;
    const file = req.file;

    try {
      if (waClient && waStatus === 'connected') {
        let sentMsg;
        let mediaUrl = null, mediaType = null, mediaName = null;

        if (file) {
          const ext = path.extname(file.originalname);
          const newPath = file.path + ext;
          fs.renameSync(file.path, newPath);
          const media = MessageMedia.fromFilePath(newPath);
          media.filename = file.originalname;
          sentMsg = await waClient.sendMessage(chatId, media, { caption: body });
          mediaUrl = `/media/${file.filename}${ext}`;
          mediaType = file.mimetype;
          mediaName = file.originalname;
        } else {
          sentMsg = await waClient.sendMessage(chatId, body);
        }

        const msgId = sentMsg.id.id;
        const timestamp = Date.now();

        db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [msgId, chatId, body || '', 1, timestamp, mediaUrl, mediaType, mediaName]);
        db.run("UPDATE chats SET last_message = ?, last_message_time = ?, last_message_from_me = 1 WHERE id = ?",
          [body || 'Media', timestamp, chatId]);
        io.emit('new_message', { id: msgId, chat_id: chatId, body: body || '', from_me: 1, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName });

        res.json({ success: true });
      } else {
        res.status(500).json({ error: 'WhatsApp not connected' });
      }
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete('/api/media/:id', (req, res) => {
    db.get("SELECT media_url FROM messages WHERE id = ?", [req.params.id], (err, row: any) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.media_url) return res.status(404).json({ error: 'Media not found' });
      const filename = row.media_url.replace('/media/', '');
      const filePath = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.run("UPDATE messages SET media_url = NULL, media_type = NULL, media_name = NULL WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    });
  });

  app.delete('/api/chats/:id', (req, res) => {
    const chatId = req.params.id;
    db.run("DELETE FROM messages WHERE chat_id = ?", [chatId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run("DELETE FROM chat_tags WHERE chat_id = ?", [chatId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run("DELETE FROM chats WHERE id = ?", [chatId], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          io.emit('chat_deleted', { id: chatId });
          res.json({ success: true });
        });
      });
    });
  });

  // ── WhatsApp Client ──
  let waClient: WAClient | null = null;
  let waStatus = 'disconnected';
  let waQrCode = '';
  let waError = '';

  const getProfilePicUrl = async (client: any, contactId: string): Promise<string | null> => {
    try {
      try {
        const url = await client.getProfilePicUrl(contactId);
        if (url) return url;
      } catch (_) {}

      const url = await client.pupPage.evaluate(async (id: string) => {
        try {
          const w = window as any;
          if (w.Store?.ProfilePic?.profilePicFind) {
            const wid = w.Store.WidFactory.createWid(id);
            if (wid && typeof wid.isNewsletter === 'undefined') wid.isNewsletter = false;
            const res = await w.Store.ProfilePic.profilePicFind(wid);
            if (res?.eurl) return res.eurl;
          }
          if (w.Store?.ProfilePic?.requestProfilePicFromServer) {
            const wid = w.Store.WidFactory.createWid(id);
            if (wid && typeof wid.isNewsletter === 'undefined') wid.isNewsletter = false;
            const res = await w.Store.ProfilePic.requestProfilePicFromServer(wid);
            if (res?.eurl) return res.eurl;
          }
          if (w.Store?.Contact) {
            const contact = w.Store.Contact.get(id);
            if (contact?.profilePicThumbObj?.eurl) return contact.profilePicThumbObj.eurl;
          }
          return null;
        } catch (_) { return null; }
      }, contactId);
      return url || null;
    } catch (_) { return null; }
  };

  const downloadProfilePic = async (url: string, chatId: string): Promise<string | null> => {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://web.whatsapp.com/'
        }
      });
      const safeId = chatId.replace(/[@.]/g, '_');
      const filename = `profile_${safeId}.jpg`;
      const filepath = path.join(MEDIA_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(response.data));
      return `/media/${filename}?t=${Date.now()}`;
    } catch (_) { return null; }
  };

  const syncChatProfilePic = async (chatId: string) => {
    if (!waClient || waStatus !== 'connected') return null;
    if (!chatId || chatId === '0@c.us') return null;
    try {
      const chat = await waClient.getChatById(chatId);
      let name = chat.name || '';
      try {
        const contact = await chat.getContact();
        if (contact) name = contact.name || contact.pushname || contact.number || name;
      } catch (_) {}

      let profilePicUrl = await getProfilePicUrl(waClient, chatId);
      if (!profilePicUrl) profilePicUrl = await waClient.getProfilePicUrl(chatId).catch(() => null);

      let profilePic = profilePicUrl ? await downloadProfilePic(profilePicUrl, chatId) : null;

      db.run("UPDATE chats SET profile_pic = ?, name = ? WHERE id = ?", [profilePic || null, name, chatId], (err) => {
        if (err) { console.error(`Error updating chat info for ${chatId}:`, err); return; }
        io.emit('chat_updated', { id: chatId, name, profile_pic: profilePic || null });
      });
      return profilePic || null;
    } catch (error: any) {
      if (!error?.message?.includes('getChat') && !error?.message?.includes('No LID') && !error?.message?.includes('Cannot read properties')) {
        console.error(`Error syncing chat info for ${chatId}:`, error);
      }
      return null;
    }
  };

  app.post('/api/chats/:id/sync-profile-pic', async (req, res) => {
    if (!waClient || waStatus !== 'connected') return res.status(400).json({ error: 'WhatsApp not connected' });
    try {
      const profilePic = await syncChatProfilePic(req.params.id);
      res.json({ success: true, profile_pic: profilePic });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/chats/sync-all-profile-pics', async (req, res) => {
    if (!waClient || waStatus !== 'connected') return res.status(400).json({ error: 'WhatsApp not connected' });
    db.all("SELECT id FROM chats", async (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: err.message });
      let count = 0;
      for (const row of rows) {
        if (row.id && row.id !== '0@c.us' && !row.id.startsWith('0@')) {
          await syncChatProfilePic(row.id);
          await new Promise(resolve => setTimeout(resolve, 1000));
          count++;
        }
      }
      res.json({ success: true, total: count });
    });
  });

  app.get('/api/debug-contacts', async (req, res) => {
    if (!waClient || waStatus !== 'connected') return res.status(400).json({ error: 'WhatsApp not connected' });
    try {
      const data = await waClient.pupPage.evaluate(async () => {
        try {
          const w = window as any;
          const contacts = w.Store.Contact.getModelsArray();
          const firstUs = contacts.find((c: any) => c.id?.server === 'c.us' && !c.isGroup);
          const firstLid = contacts.find((c: any) => c.id?.server === 'lid');
          return {
            usKeys: firstUs ? Object.keys(firstUs).filter(k => typeof firstUs[k] !== 'function') : [],
            usProps: firstUs ? { id: firstUs.id, lidJid: firstUs.lidJid, phoneNumber: firstUs.phoneNumber, name: firstUs.name, pushname: firstUs.pushname } : null,
            lidKeys: firstLid ? Object.keys(firstLid).filter(k => typeof firstLid[k] !== 'function') : [],
            lidProps: firstLid ? { id: firstLid.id, lidJid: firstLid.lidJid, phoneNumber: firstLid.phoneNumber, name: firstLid.name, pushname: firstLid.pushname } : null,
            totalContacts: contacts.length
          };
        } catch (e: any) { return { error: e.toString() }; }
      });
      res.json(data);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─────────────────────────────────────────────────────────────
  // CORE: find or create chat using @c.us as primary format.
  // Searches by exact ID, by phone number, and by numeric part
  // of the JID — so we never duplicate a contact regardless of
  // whether the incoming event carried @c.us or @lid.
  // ─────────────────────────────────────────────────────────────
  const findOrCreateChat = (
    chatId: string,        // already normalized to @c.us when possible
    phone: string,         // clean digits only
    name: string,
    displayBody: string,
    timestamp: number,
    fromMe: number,
    profilePic: string | null,
    onFound: (existingId: string) => void,
    onCreated: () => void
  ) => {
    const numericPart = jidToPhone(chatId);

    // Search by exact id OR by phone OR by numeric part of any existing id
    db.all(
      `SELECT id, profile_pic FROM chats
       WHERE id = ?
         OR (phone = ? AND phone != '' AND phone IS NOT NULL)
         OR (REPLACE(REPLACE(id,'@c.us',''),'@lid','') = ?)`,
      [chatId, phone, numericPart],
      (err, rows: any[]) => {
        if (err) rows = [];

        if (rows && rows.length > 0) {
          // Pick the best match: prefer @c.us, then the first result
          const preferred = rows.find(r => r.id.endsWith('@c.us')) || rows[0];
          const existingId = preferred.id;
          const finalProfilePic = profilePic || preferred.profile_pic;

          // If there are duplicates, merge them into the preferred one
          if (rows.length > 1) {
            const toMerge = rows.filter(r => r.id !== existingId);
            toMerge.forEach(dup => {
              db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [existingId, dup.id]);
              db.run("UPDATE OR IGNORE chat_tags SET chat_id = ? WHERE chat_id = ?", [existingId, dup.id]);
              db.run("DELETE FROM chats WHERE id = ?", [dup.id]);
              io.emit('chat_deleted', { id: dup.id });
            });
          }

          // If the preferred ID isn't in @c.us format but we now have a phone, upgrade it
          if (!existingId.endsWith('@c.us') && chatId.endsWith('@c.us') && existingId !== chatId) {
            db.run("UPDATE chats SET id = ?, phone = ? WHERE id = ?", [chatId, phone, existingId], (err) => {
              if (err && err.message.includes('UNIQUE constraint failed')) {
                // Target already exists — merge and delete old
                db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [chatId, existingId]);
                db.run("UPDATE OR IGNORE chat_tags SET chat_id = ? WHERE chat_id = ?", [chatId, existingId]);
                db.run("DELETE FROM chats WHERE id = ?", [existingId]);
              } else {
                db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [chatId, existingId]);
                db.run("UPDATE chat_tags SET chat_id = ? WHERE chat_id = ?", [chatId, existingId]);
              }
              io.emit('chat_deleted', { id: existingId });
            });
            onFound(chatId);
          } else {
            onFound(existingId);
          }

          const unreadUpdate = fromMe ? "" : ", unread_count = unread_count + 1";
          db.run(
            `UPDATE chats SET last_message = ?, last_message_time = ?, profile_pic = ?, name = ?, last_message_from_me = ?${unreadUpdate} WHERE id = ?`,
            [displayBody, timestamp, finalProfilePic, name, fromMe, existingId],
            () => {
              io.emit('chat_updated', { id: existingId, last_message: displayBody, last_message_time: timestamp, profile_pic: finalProfilePic, name, last_message_from_me: fromMe });
            }
          );
        } else {
          // Truly new chat
          db.get("SELECT id FROM columns ORDER BY position ASC LIMIT 1", (err, colRow: any) => {
            const colId = colRow ? colRow.id : 'col-1';
            const unreadCount = fromMe ? 0 : 1;
            db.run(
              "INSERT INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count, profile_pic, last_message_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [chatId, name, phone, colId, displayBody, timestamp, unreadCount, profilePic, fromMe],
              () => {
                io.emit('new_chat', { id: chatId, name, phone, column_id: colId, last_message: displayBody, last_message_time: timestamp, unread_count: unreadCount, profile_pic: profilePic, last_message_from_me: fromMe });
                onCreated();
              }
            );
          });
        }
      }
    );
  };

  const initWhatsApp = () => {
    console.log('Initializing WhatsApp Client...');
    waStatus = 'initializing';
    waError = '';
    io.emit('wa_status', { status: waStatus });

    const authPath = path.join(DATA_DIR, 'wa_auth');
    try {
      const lockFiles = [
        path.join(authPath, 'session', 'SingletonLock'),
        path.join(authPath, 'session', 'SingletonCookie'),
        path.join(authPath, 'session', 'SingletonSocket'),
        path.join(authPath, 'session', 'Default', 'SingletonLock'),
        path.join(authPath, 'session', 'Default', 'SingletonCookie'),
        path.join(authPath, 'session', 'Default', 'SingletonSocket')
      ];
      for (const file of lockFiles) {
        try { if (fs.lstatSync(file)) fs.unlinkSync(file); } catch (e: any) { if (e.code !== 'ENOENT') console.error(`Error removing ${file}:`, e); }
      }
    } catch (e) { console.error('Error cleaning lock files:', e); }

    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu']
      }
    });

    waClient.on('qr', async (qr) => {
      console.log('QR Code Received');
      waStatus = 'qr';
      waQrCode = await qrcode.toDataURL(qr);
      io.emit('wa_status', { status: waStatus, qr: waQrCode });
    });

    waClient.on('ready', async () => {
      console.log('✅ WhatsApp Client is ready!');
      waStatus = 'connected';
      waQrCode = '';
      io.emit('wa_status', { status: waStatus });

      try {
        const contacts = await waClient!.getContacts();
        console.log(`📋 Fetched ${contacts.length} contacts for name sync.`);
        const dbChats: any[] = await new Promise((resolve) => {
          db.all("SELECT id, name, phone FROM chats", (err, rows) => resolve(rows || []));
        });

        for (const chat of dbChats) {
          if (!chat.id || chat.id === '0@c.us' || chat.id.startsWith('0@')) continue;

          const contactMatch = contacts.find(c =>
            c.id._serialized === chat.id ||
            c.number === chat.phone ||
            (chat.phone && c.id._serialized.includes(chat.phone)) ||
            (chat.id.includes('@lid') && (c as any).lidJid === chat.id)
          );

          if (contactMatch) {
            let targetChatId = chat.id;
            const resolvedPhone = contactMatch.number?.replace(/\D/g, '');
            if (resolvedPhone && resolvedPhone.length <= 15) {
              const newId = `${resolvedPhone}@c.us`;
              if (chat.id !== newId) {
                console.log(`🔄 [READY SYNC] Upgrading ${chat.id} → ${newId}`);
                db.run("UPDATE chats SET id = ?, phone = ? WHERE id = ?", [newId, resolvedPhone, chat.id], (err) => {
                  if (err && err.message.includes('UNIQUE constraint failed')) {
                    db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [newId, chat.id]);
                    db.run("UPDATE OR IGNORE chat_tags SET chat_id = ? WHERE chat_id = ?", [newId, chat.id]);
                    db.run("DELETE FROM chats WHERE id = ?", [chat.id]);
                  } else {
                    db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [newId, chat.id]);
                    db.run("UPDATE chat_tags SET chat_id = ? WHERE chat_id = ?", [newId, chat.id]);
                  }
                  io.emit('chat_deleted', { id: chat.id });
                });
                targetChatId = newId;
              }
            }

            const newName = contactMatch.name || contactMatch.pushname || contactMatch.verifiedName;
            if (newName && newName !== chat.name && newName !== chat.phone) {
              db.run("UPDATE chats SET name = ? WHERE id = ?", [newName, targetChatId], () => {
                io.emit('chat_updated', { id: targetChatId, name: newName });
              });
            }
            chat.id = targetChatId;
          }

          syncChatProfilePic(chat.id);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        console.error('Error syncing contacts on ready:', err);
      }
    });

    waClient.on('authenticated', () => {
      console.log('🔐 WhatsApp Authenticated');
    });

    waClient.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp Auth Failure:', msg);
      waStatus = 'error';
      waError = msg;
      io.emit('wa_status', { status: waStatus, error: waError });
    });

    waClient.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp Disconnected:', reason);
      waStatus = 'disconnected';
      io.emit('wa_status', { status: waStatus });
      setTimeout(initWhatsApp, 5000);
    });

    // ─────────────────────────────────────────────────────────────
    // MESSAGE HANDLER — all incoming and outgoing messages
    // Rule: ALWAYS prefer @c.us. @lid is only kept as last resort.
    // ─────────────────────────────────────────────────────────────
    waClient.on('message_create', async (msg) => {
      if (msg.isStatus) return;

      const chat = await msg.getChat();
      if (chat.isGroup) return;

      const rawJid = chat.id._serialized;
      const fromMe = msg.fromMe ? 1 : 0;

      // ── Step 1: get contact info ──
      let contact = await chat.getContact();
      let name: string = (contact as any).verifiedName || contact.name || contact.pushname || contact.number || rawJid;
      let phone: string = (contact.number || '').replace(/\D/g, '');

      // ── Step 2: if rawJid is @lid or phone looks like a LID, try to resolve ──
      const isLid = rawJid.includes('@lid') || phone.length > 15;
      if (isLid) {
        console.log(`🔍 [MSG] Received @lid JID: ${rawJid} — attempting phone resolution...`);
        const resolved = await resolveLidToPhone(waClient!, rawJid);
        if (resolved) {
          phone = resolved.replace(/\D/g, '');
          console.log(`✅ [MSG] Resolved ${rawJid} → ${phone}@c.us`);
        } else {
          console.warn(`⚠️ [MSG] Could not resolve LID ${rawJid} to a phone number — will use LID as fallback`);
        }
      }

      // ── Step 3: build the canonical chatId — always @c.us when possible ──
      const chatId = buildChatId(phone, rawJid);

      // ── Step 4: LOG the message event ──
      const direction = fromMe ? '📤 SENT' : '📨 RECV';
      console.log(`${direction} | chatId: ${chatId} | rawJid: ${rawJid} | phone: ${phone || 'unknown'} | name: ${name} | type: ${msg.type} | body: ${(msg.body || '').substring(0, 80)}${msg.body?.length > 80 ? '...' : ''}`);

      // ── Step 5: handle media ──
      let body = msg.body;
      const timestamp = msg.timestamp * 1000;
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mediaName: string | null = null;
      let transcription: string | null = null;

      if (msg.hasMedia && msg.type !== 'interactive' && msg.type !== 'interactive_response') {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            const ext = media.mimetype.split('/')[1].split(';')[0];
            const filename = `${msg.id.id}.${ext}`;
            const filepath = path.join(MEDIA_DIR, filename);
            fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
            mediaUrl = `/media/${filename}`;
            mediaType = media.mimetype;
            mediaName = media.filename || filename;
            console.log(`📎 [MEDIA] Saved ${mediaType} → ${filename}`);

            if (media.mimetype.startsWith('audio/') && process.env.GEMINI_API_KEY) {
              try {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: [
                    { inlineData: { data: media.data, mimeType: media.mimetype } },
                    'Transcreva este áudio em português. Retorne apenas a transcrição.'
                  ]
                });
                transcription = response.text;
                console.log(`🎙️ [TRANSCRIPTION] ${chatId}: ${(transcription || '').substring(0, 100)}`);
              } catch (err) {
                console.error('Transcription error:', err);
              }
            }
          }
        } catch (err: any) {
          if (!err?.message?.includes('webMediaType is invalid')) {
            console.error('Error downloading media:', err);
          }
        }
      }

      const displayBody = body || (mediaType ? `[Media: ${mediaType}]` : '');

      // ── Step 6: fetch profile pic ──
      let profilePic: string | null = null;
      try {
        let picUrl = await getProfilePicUrl(waClient!, chatId);
        if (!picUrl) picUrl = await waClient!.getProfilePicUrl(chatId).catch(() => null);
        if (picUrl) profilePic = await downloadProfilePic(picUrl, chatId);
      } catch (_) {}

      // ── Step 7: skip if message already saved ──
      db.get("SELECT id FROM messages WHERE id = ?", [msg.id.id], (err, row) => {
        if (row) {
          console.log(`⏭️ [MSG] Duplicate, skipping: ${msg.id.id}`);
          return;
        }

        // ── Step 8: find or create chat (handles duplicates / merges) ──
        findOrCreateChat(
          chatId, phone, name, displayBody, timestamp, fromMe, profilePic,
          (existingId) => {
            // Save message linked to the canonical chat id
            db.run(
              "INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name, transcription) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [msg.id.id, existingId, body, fromMe, timestamp, mediaUrl, mediaType, mediaName, transcription],
              async () => {
                io.emit('new_message', { id: msg.id.id, chat_id: existingId, body, from_me: fromMe, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName, transcription });
                console.log(`💾 [SAVED] msgId: ${msg.id.id} → chat: ${existingId}`);

                // ── AI auto-reply for MY_PHONE ──
                const myPhone = process.env.MY_PHONE?.replace(/\D/g, '');
                if (myPhone && phone === myPhone && !fromMe && process.env.GEMINI_API_KEY) {
                  try {
                    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                    const aiMemory = await new Promise<any[]>((resolve) => {
                      aiDb.all("SELECT * FROM ai_memory ORDER BY created_at DESC", (err, rows) => resolve(rows || []));
                    });

                    const systemInstruction = `Você é o assistente pessoal do usuário. Você está conversando com ele pelo WhatsApp.
Data e hora atual: ${new Date().toLocaleString('pt-BR')}
Sua memória atual (tarefas, lembretes, base de conhecimento):
${JSON.stringify(aiMemory)}

Se o usuário pedir para adicionar algo à sua memória, retorne APENAS o JSON:
{"command": "ADD_MEMORY", "params": {"content": "O que deve ser lembrado", "trigger_at": "2026-05-10T09:00:00"}}

Se o usuário pedir para enviar uma mensagem para alguém, retorne APENAS o JSON:
{"command": "SEND_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem"}}

Se o usuário pedir para agendar o envio de uma mensagem para alguém, retorne APENAS o JSON:
{"command": "SCHEDULE_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem", "trigger_at": "2026-05-10T09:00:00"}}

Caso contrário, responda de forma natural, útil e prestativa.`;

                    const response = await ai.models.generateContent({
                      model: 'gemini-3-flash-preview',
                      contents: body || transcription || 'Mensagem de mídia',
                      config: { systemInstruction }
                    });

                    let replyText = response.text || '';

                    try {
                      const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
                      if (cleanJson.startsWith('{') && cleanJson.endsWith('}')) {
                        const cmd = JSON.parse(cleanJson);
                        if (cmd.command === 'ADD_MEMORY') {
                          const triggerAt = cmd.params.trigger_at ? new Date(cmd.params.trigger_at).getTime() : null;
                          await new Promise((resolve) => {
                            aiDb.run("INSERT INTO ai_memory (content, created_at, trigger_at, is_triggered) VALUES (?, ?, ?, ?)",
                              [cmd.params.content, Date.now(), triggerAt, 0], resolve);
                          });
                          replyText = triggerAt
                            ? `✅ Lembrete agendado para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n"${cmd.params.content}"`
                            : `✅ Lembrete/Tarefa adicionada à minha memória:\n"${cmd.params.content}"`;
                        } else if (cmd.command === 'SEND_MESSAGE') {
                          const toPhone = (cmd.params.phone || '').replace(/\D/g, '');
                          const msgText = cmd.params.message;
                          if (toPhone && msgText && waClient && waStatus === 'connected') {
                            await waClient.sendMessage(`${toPhone}@c.us`, msgText);
                            console.log(`📤 [AI CMD] SEND_MESSAGE → ${toPhone}@c.us: ${msgText}`);
                            replyText = `✅ Mensagem enviada para ${toPhone}:\n"${msgText}"`;
                          }
                        } else if (cmd.command === 'SCHEDULE_MESSAGE') {
                          const toPhone = (cmd.params.phone || '').replace(/\D/g, '');
                          const msgText = cmd.params.message;
                          const triggerAt = cmd.params.trigger_at ? new Date(cmd.params.trigger_at).getTime() : null;
                          if (triggerAt && toPhone && msgText) {
                            await new Promise((resolve) => {
                              aiDb.run("INSERT INTO scheduled_messages (phone, message, trigger_at, is_triggered, created_at) VALUES (?, ?, ?, ?, ?)",
                                [toPhone, msgText, triggerAt, 0, Date.now()], resolve);
                            });
                            console.log(`⏰ [AI CMD] SCHEDULE_MESSAGE → ${toPhone} at ${new Date(triggerAt).toISOString()}`);
                            replyText = `✅ Mensagem agendada para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\nPara: ${toPhone}\n"${msgText}"`;
                          }
                        }
                      }
                    } catch (_) {}

                    if (replyText) {
                      await waClient!.sendMessage(existingId, replyText);
                      console.log(`🤖 [AI REPLY] → ${existingId}: ${replyText.substring(0, 80)}`);
                    }
                  } catch (err) {
                    console.error('Error processing AI message:', err);
                  }
                }
              }
            );
          },
          () => {
            // onCreated — message already saved inside findOrCreateChat callback above? No, save here too.
            db.run(
              "INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name, transcription) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [msg.id.id, chatId, body, fromMe, timestamp, mediaUrl, mediaType, mediaName, transcription],
              () => {
                io.emit('new_message', { id: msg.id.id, chat_id: chatId, body, from_me: fromMe, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName, transcription });
                console.log(`💾 [SAVED NEW] msgId: ${msg.id.id} → chat: ${chatId}`);
              }
            );
          }
        );
      });
    });

    waClient.initialize().catch(err => {
      console.error('Failed to initialize WhatsApp:', err);
      waStatus = 'error';
      waError = err.message;
      io.emit('wa_status', { status: waStatus, error: waError });
    });
  };

  initWhatsApp();

  app.get('/api/wa/status', (req, res) => {
    res.json({ status: waStatus, qr: waQrCode, error: waError });
  });

  app.post('/api/wa/reset', async (req, res) => {
    if (waClient) { try { await waClient.destroy(); } catch (_) {} }
    const authPath = path.join(DATA_DIR, 'wa_auth');
    if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
    initWhatsApp();
    res.json({ success: true });
  });

  app.post('/api/wa/restart', async (req, res) => {
    if (waClient) { try { await waClient.destroy(); } catch (_) {} }
    initWhatsApp();
    res.json({ success: true });
  });

  // ── Vite / Static ──
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
