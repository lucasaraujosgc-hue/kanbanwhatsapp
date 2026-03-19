import express from 'express';
import { createServer as createViteServer } from 'vite';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DATA_DIR, 'kanban.db'));

// Initialize Database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    column_id TEXT,
    last_message TEXT,
    last_message_time INTEGER,
    unread_count INTEGER DEFAULT 0
  )`);

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

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    body TEXT,
    from_me INTEGER,
    timestamp INTEGER
  )`);

  // Insert default columns if empty
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
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());
  app.use(express.json());

  // --- API Routes ---
  app.get('/api/columns', (req, res) => {
    db.all("SELECT * FROM columns ORDER BY position ASC", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post('/api/columns', (req, res) => {
    const { id, name, position } = req.body;
    db.run("INSERT INTO columns (id, name, position) VALUES (?, ?, ?)", [id, name, position], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('columns_updated');
      res.json({ success: true });
    });
  });

  app.put('/api/columns/:id', (req, res) => {
    const { name, position } = req.body;
    db.run("UPDATE columns SET name = ?, position = ? WHERE id = ?", [name, position, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('columns_updated');
      res.json({ success: true });
    });
  });

  app.delete('/api/columns/:id', (req, res) => {
    db.run("DELETE FROM columns WHERE id = ?", [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('columns_updated');
      res.json({ success: true });
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
      const formattedRows = rows.map((r: any) => ({
        ...r,
        tag_ids: r.tag_ids ? r.tag_ids.split(',') : []
      }));
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

  app.get('/api/tags', (req, res) => {
    db.all("SELECT * FROM tags", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
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

  app.post('/api/chats/:id/messages', async (req, res) => {
    const { body } = req.body;
    const chatId = req.params.id;
    
    try {
      if (waClient && waStatus === 'connected') {
        await waClient.sendMessage(chatId, body);
        
        const msgId = 'msg-' + Date.now();
        const timestamp = Date.now();
        
        db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp) VALUES (?, ?, ?, ?, ?)",
          [msgId, chatId, body, 1, timestamp]);
          
        db.run("UPDATE chats SET last_message = ?, last_message_time = ? WHERE id = ?",
          [body, timestamp, chatId]);
          
        io.emit('new_message', {
          id: msgId,
          chat_id: chatId,
          body,
          from_me: 1,
          timestamp
        });
        
        res.json({ success: true });
      } else {
        res.status(500).json({ error: 'WhatsApp not connected' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- WhatsApp Client Setup ---
  let waClient: Client | null = null;
  let waStatus = 'disconnected';
  let waQrCode = '';

  const initWhatsApp = () => {
    console.log('Initializing WhatsApp Client...');
    waStatus = 'initializing';
    io.emit('wa_status', { status: waStatus });

    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'wa_auth') }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    waClient.on('qr', async (qr) => {
      console.log('QR Code Received');
      waStatus = 'qr';
      waQrCode = await qrcode.toDataURL(qr);
      io.emit('wa_status', { status: waStatus, qr: waQrCode });
    });

    waClient.on('ready', () => {
      console.log('WhatsApp Client is ready!');
      waStatus = 'connected';
      waQrCode = '';
      io.emit('wa_status', { status: waStatus });
    });

    waClient.on('authenticated', () => {
      console.log('WhatsApp Authenticated');
    });

    waClient.on('auth_failure', (msg) => {
      console.error('WhatsApp Auth Failure:', msg);
      waStatus = 'error';
      io.emit('wa_status', { status: waStatus, error: msg });
    });

    waClient.on('disconnected', (reason) => {
      console.log('WhatsApp Disconnected:', reason);
      waStatus = 'disconnected';
      io.emit('wa_status', { status: waStatus });
      
      // Re-initialize after a delay
      setTimeout(initWhatsApp, 5000);
    });

    waClient.on('message', async (msg) => {
      if (msg.isStatus) return;
      
      const chat = await msg.getChat();
      if (chat.isGroup) return; // Ignore groups for now

      const chatId = chat.id._serialized;
      const contact = await msg.getContact();
      const name = contact.name || contact.pushname || contact.number;
      const phone = contact.number;
      const body = msg.body;
      const timestamp = msg.timestamp * 1000;

      // Check if chat exists
      db.get("SELECT id FROM chats WHERE id = ?", [chatId], (err, row) => {
        if (!row) {
          // New chat, put in first column
          db.get("SELECT id FROM columns ORDER BY position ASC LIMIT 1", (err, colRow: any) => {
            const colId = colRow ? colRow.id : 'col-1';
            db.run("INSERT INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count) VALUES (?, ?, ?, ?, ?, ?, 1)",
              [chatId, name, phone, colId, body, timestamp], () => {
                io.emit('new_chat', { id: chatId, name, phone, column_id: colId, last_message: body, last_message_time: timestamp, unread_count: 1 });
              });
          });
        } else {
          // Update existing chat
          db.run("UPDATE chats SET last_message = ?, last_message_time = ?, unread_count = unread_count + 1 WHERE id = ?",
            [body, timestamp, chatId], () => {
              io.emit('chat_updated', { id: chatId, last_message: body, last_message_time: timestamp });
            });
        }
      });

      // Save message
      db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp) VALUES (?, ?, ?, ?, ?)",
        [msg.id.id, chatId, body, 0, timestamp], () => {
          io.emit('new_message', { id: msg.id.id, chat_id: chatId, body, from_me: 0, timestamp });
        });
    });

    waClient.initialize().catch(err => {
      console.error('Failed to initialize WhatsApp:', err);
      waStatus = 'error';
      io.emit('wa_status', { status: waStatus, error: err.message });
    });
  };

  // Start WhatsApp
  initWhatsApp();

  app.get('/api/wa/status', (req, res) => {
    res.json({ status: waStatus, qr: waQrCode });
  });

  app.post('/api/wa/reset', async (req, res) => {
    if (waClient) {
      try {
        await waClient.destroy();
      } catch (e) {}
    }
    const authPath = path.join(DATA_DIR, 'wa_auth');
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    initWhatsApp();
    res.json({ success: true });
  });

  // --- Vite Middleware for Development ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
