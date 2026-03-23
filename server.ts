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

const MEDIA_DIR = path.join(DATA_DIR, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const upload = multer({ dest: MEDIA_DIR });

const db = new sqlite3.Database(path.join(DATA_DIR, 'kanban.db'));

// Initialize Database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    color TEXT DEFAULT '#e2e8f0'
  )`);

  // Try to add color column if it doesn't exist (for existing databases)
  db.run(`ALTER TABLE columns ADD COLUMN color TEXT DEFAULT '#e2e8f0'`, (err) => { /* ignore if exists */ });

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    column_id TEXT,
    last_message TEXT,
    last_message_time INTEGER,
    unread_count INTEGER DEFAULT 0,
    profile_pic TEXT
  )`);

  // Try to add profile_pic column if it doesn't exist
  db.run(`ALTER TABLE chats ADD COLUMN profile_pic TEXT`, (err) => { /* ignore */ });

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
    timestamp INTEGER,
    media_url TEXT,
    media_type TEXT,
    media_name TEXT,
    transcription TEXT
  )`);

  // Try to add media columns if they don't exist
  db.run(`ALTER TABLE messages ADD COLUMN media_url TEXT`, (err) => { /* ignore */ });
  db.run(`ALTER TABLE messages ADD COLUMN media_type TEXT`, (err) => { /* ignore */ });
  db.run(`ALTER TABLE messages ADD COLUMN media_name TEXT`, (err) => { /* ignore */ });
  db.run(`ALTER TABLE messages ADD COLUMN transcription TEXT`, (err) => { /* ignore */ });

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

  // Serve media files
  app.use('/media', express.static(MEDIA_DIR));

  // Password protection middleware
  const checkPassword = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const appPassword = process.env.PASSWORD;
    if (!appPassword) return next(); // No password set
    
    // Allow public access to media if needed, or protect it? Let's protect API only for now, media can be protected too.
    if (req.path.startsWith('/api/login')) return next();

    const clientPassword = req.headers['x-app-password'];
    if (clientPassword === appPassword) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!process.env.PASSWORD || password === process.env.PASSWORD) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  });

  app.use('/api', checkPassword);

  // --- API Routes ---
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
    // Find another column to move chats to
    db.get("SELECT id FROM columns WHERE id != ? ORDER BY position ASC LIMIT 1", [colId], (err, row: any) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const targetColId = row ? row.id : null;
      
      if (targetColId) {
        db.run("UPDATE chats SET column_id = ? WHERE column_id = ?", [targetColId, colId], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          
          db.run("DELETE FROM columns WHERE id = ?", [colId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('columns_updated');
            io.emit('chat_updated'); // Trigger chat refresh
            res.json({ success: true });
          });
        });
      } else {
        // Can't delete the last column
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
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
            const filePath = path.join(MEDIA_DIR, filename);
            const stats = fs.statSync(filePath);
            size = stats.size;
          } catch (e) {
            // File might not exist
          }
        }
        return {
          ...row,
          size
        };
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
        let mediaUrl = null;
        let mediaType = null;
        let mediaName = null;

        if (file) {
          const media = MessageMedia.fromFilePath(file.path);
          media.filename = file.originalname;
          sentMsg = await waClient.sendMessage(chatId, media, { caption: body });
          
          // Move file to have original extension
          const ext = path.extname(file.originalname);
          const newPath = file.path + ext;
          fs.renameSync(file.path, newPath);
          
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
          
        db.run("UPDATE chats SET last_message = ?, last_message_time = ? WHERE id = ?",
          [body || 'Media', timestamp, chatId]);
          
        io.emit('new_message', {
          id: msgId,
          chat_id: chatId,
          body: body || '',
          from_me: 1,
          timestamp,
          media_url: mediaUrl,
          media_type: mediaType,
          media_name: mediaName
        });
        
        res.json({ success: true });
      } else {
        res.status(500).json({ error: 'WhatsApp not connected' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/media/:id', (req, res) => {
    const mediaId = req.params.id;
    db.get("SELECT media_url FROM messages WHERE id = ?", [mediaId], (err, row: any) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.media_url) return res.status(404).json({ error: 'Media not found' });
      
      const filename = row.media_url.replace('/media/', '');
      const filePath = path.join(MEDIA_DIR, filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      db.run("UPDATE messages SET media_url = NULL, media_type = NULL, media_name = NULL WHERE id = ?", [mediaId], (err) => {
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

  // --- WhatsApp Client Setup ---
  let waClient: WAClient | null = null;
  let waStatus = 'disconnected';
  let waQrCode = '';
  let waError = '';

  const getProfilePicUrl = async (client: any, contactId: string): Promise<string | null> => {
    try {
      const url = await client.pupPage.evaluate(async (id: string) => {
        try {
          const w = window as any;
          // Try getting from Contact model first
          const contact = w.Store.Contact.get(id);
          if (contact && contact.profilePicThumbObj && contact.profilePicThumbObj.eurl) {
            return contact.profilePicThumbObj.eurl;
          }
          
          // Fallback to ProfilePic API
          const chatWid = w.Store.WidFactory.createWid(id);
          // Fix for the 'isNewsletter' error in newer WhatsApp Web versions
          if (chatWid && typeof chatWid.isNewsletter === 'undefined') {
            chatWid.isNewsletter = false;
          }
          
          const res = w.compareWwebVersions(w.Debug.VERSION, '<', '2.3000.0')
            ? await w.Store.ProfilePic.profilePicFind(chatWid)
            : await w.Store.ProfilePic.requestProfilePicFromServer(chatWid);
            
          return res ? res.eurl : null;
        } catch (err) {
          return null;
        }
      }, contactId);
      return url || null;
    } catch (err) {
      console.error(`Error getting profile pic for ${contactId}:`, err);
      return null;
    }
  };

  const syncChatProfilePic = async (chatId: string) => {
    if (!waClient || waStatus !== 'connected') return null;

    try {
      const chat = await waClient.getChatById(chatId);
      const contact = await chat.getContact();
      const name = contact.name || contact.pushname || contact.number;
      let profilePic = await getProfilePicUrl(waClient, chatId);
      if (!profilePic) {
        profilePic = await waClient.getProfilePicUrl(chatId).catch(() => null);
      }

      db.run(
        "UPDATE chats SET profile_pic = ?, name = ? WHERE id = ?",
        [profilePic || null, name, chatId],
        (err) => {
          if (err) {
            console.error(`Error updating chat info for ${chatId}:`, err);
            return;
          }

          io.emit('chat_updated', {
            id: chatId,
            name: name,
            profile_pic: profilePic || null
          });
        }
      );

      return profilePic || null;
    } catch (error) {
      console.error(`Error syncing chat info for ${chatId}:`, error);
      return null;
    }
  };

  app.post('/api/chats/:id/sync-profile-pic', async (req, res) => {
    const chatId = req.params.id;

    if (!waClient || waStatus !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    try {
      const profilePic = await syncChatProfilePic(chatId);

      res.json({
        success: true,
        profile_pic: profilePic
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/chats/sync-all-profile-pics', async (req, res) => {
    if (!waClient || waStatus !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    db.all("SELECT id FROM chats", async (err, rows: any[]) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      try {
        for (const row of rows) {
          await syncChatProfilePic(row.id);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        res.json({ success: true, total: rows.length });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  });

  const initWhatsApp = () => {
    console.log('Initializing WhatsApp Client...');
    waStatus = 'initializing';
    waError = '';
    io.emit('wa_status', { status: waStatus });

    // Remove Chromium lock files if they exist to prevent "profile in use" errors
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
        try {
          if (fs.lstatSync(file)) {
            fs.unlinkSync(file);
            console.log(`Removed lock file: ${file}`);
          }
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.error(`Error checking/removing ${file}:`, err);
          }
        }
      }
    } catch (e) {
      console.error('Error cleaning up lock files:', e);
    }

    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
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

      db.all("SELECT id FROM chats", async (err, rows: any[]) => {
        if (err) {
          console.error('Error loading chats for profile pic sync:', err);
          return;
        }

        for (const row of rows) {
          await syncChatProfilePic(row.id);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      });
    });

    waClient.on('authenticated', () => {
      console.log('WhatsApp Authenticated');
    });

    waClient.on('auth_failure', (msg) => {
      console.error('WhatsApp Auth Failure:', msg);
      waStatus = 'error';
      waError = msg;
      io.emit('wa_status', { status: waStatus, error: waError });
    });

    waClient.on('disconnected', (reason) => {
      console.log('WhatsApp Disconnected:', reason);
      waStatus = 'disconnected';
      io.emit('wa_status', { status: waStatus });
      
      // Re-initialize after a delay
      setTimeout(initWhatsApp, 5000);
    });

    waClient.on('message_create', async (msg) => {
      if (msg.isStatus) return;
      
      const chat = await msg.getChat();
      if (chat.isGroup) return; // Ignore groups for now

      const chatId = chat.id._serialized;
      const contact = await chat.getContact();
      const name = contact.name || contact.pushname || contact.number;
      const phone = contact.number;
      let body = msg.body;
      const timestamp = msg.timestamp * 1000;
      const fromMe = msg.fromMe ? 1 : 0;

      let mediaUrl = null;
      let mediaType = null;
      let mediaName = null;
      let transcription = null;

      if (msg.hasMedia) {
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

            // Transcribe audio using Gemini
            if (media.mimetype.startsWith('audio/') && process.env.GEMINI_API_KEY) {
              try {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: [
                    {
                      inlineData: {
                        data: media.data,
                        mimeType: media.mimetype,
                      },
                    },
                    'Transcreva este áudio em português. Retorne apenas a transcrição.',
                  ],
                });
                transcription = response.text;
              } catch (err) {
                console.error('Transcription error:', err);
              }
            }
          }
        } catch (err) {
          console.error('Error downloading media:', err);
        }
      }

      const displayBody = body || (mediaType ? `[Media: ${mediaType}]` : '');

      let profilePic: string | null = null;
      try {
        // Tenta buscar a foto atualizada
        profilePic = await getProfilePicUrl(waClient, chatId);
        
        // Se falhar no Puppeteer, tenta o método nativo do waClient como backup
        if (!profilePic) {
          profilePic = await waClient.getProfilePicUrl(chatId).catch(() => null);
        }
      } catch (e) {
        console.log("Erro ao recuperar foto para:", chatId);
      }

      // Check if message already exists (e.g., sent from web UI)
      db.get("SELECT id FROM messages WHERE id = ?", [msg.id.id], (err, row) => {
        if (row) return; // Message already processed

        db.get("SELECT id, profile_pic FROM chats WHERE id = ? OR (phone = ? AND phone IS NOT NULL AND phone != '')", [chatId, phone], (err, chatRow: any) => {
          if (!chatRow) {
            // New chat, put in first column
            db.get("SELECT id FROM columns ORDER BY position ASC LIMIT 1", (err, colRow: any) => {
              const colId = colRow ? colRow.id : 'col-1';
              const unreadCount = fromMe ? 0 : 1;
              db.run("INSERT INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count, profile_pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [chatId, name, phone, colId, displayBody, timestamp, unreadCount, profilePic], () => {
                  io.emit('new_chat', { id: chatId, name, phone, column_id: colId, last_message: displayBody, last_message_time: timestamp, unread_count: unreadCount, profile_pic: profilePic });
                });
            });
          } else {
            // Update existing chat
            const unreadUpdate = fromMe ? "" : ", unread_count = unread_count + 1";
            const finalProfilePic = profilePic || chatRow.profile_pic;
            
            db.serialize(() => {
              if (chatRow.id !== chatId) {
                // ID changed (e.g., WhatsApp added 9th digit)
                db.run("UPDATE chats SET id = ? WHERE id = ?", [chatId, chatRow.id]);
                db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [chatId, chatRow.id]);
                db.run("UPDATE chat_tags SET chat_id = ? WHERE chat_id = ?", [chatId, chatRow.id]);
                io.emit('chat_deleted', { id: chatRow.id });
                
                // We will emit new_chat after the update below
                db.get("SELECT * FROM chats WHERE id = ?", [chatId], (err, updatedChatRow: any) => {
                  if (updatedChatRow) {
                    io.emit('new_chat', updatedChatRow);
                  }
                });
              }
              
              db.run(`UPDATE chats SET last_message = ?, last_message_time = ?, profile_pic = ?, name = ?${unreadUpdate} WHERE id = ?`,
                [displayBody, timestamp, finalProfilePic, name, chatId], () => {
                  io.emit('chat_updated', { id: chatId, last_message: displayBody, last_message_time: timestamp, profile_pic: finalProfilePic, name });
                });
            });
          }
        });

        // Save message
        db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name, transcription) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [msg.id.id, chatId, body, fromMe, timestamp, mediaUrl, mediaType, mediaName, transcription], () => {
            io.emit('new_message', { id: msg.id.id, chat_id: chatId, body, from_me: fromMe, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName, transcription });
          });
      });
    });

    waClient.initialize().catch(err => {
      console.error('Failed to initialize WhatsApp:', err);
      waStatus = 'error';
      waError = err.message;
      io.emit('wa_status', { status: waStatus, error: waError });
    });
  };

  // Start WhatsApp
  initWhatsApp();

  app.get('/api/wa/status', (req, res) => {
    res.json({ status: waStatus, qr: waQrCode, error: waError });
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

  app.post('/api/wa/restart', async (req, res) => {
    if (waClient) {
      try {
        await waClient.destroy();
      } catch (e) {}
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