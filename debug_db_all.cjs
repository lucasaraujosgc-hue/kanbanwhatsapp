const sqlite3 = require('sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/backup';
let dbPath = path.join(__dirname, 'data', 'kanban.db');
if (require('fs').existsSync(path.join(DATA_DIR, 'kanban.db'))) {
    dbPath = path.join(DATA_DIR, 'kanban.db');
} else if (require('fs').existsSync(path.join(__dirname, 'kanban.db'))) {
    dbPath = path.join(__dirname, 'kanban.db');
} else if (require('fs').existsSync('/app/kanban.db')) {
    dbPath = '/app/kanban.db';
}

const db = new sqlite3.Database(dbPath);

db.get("SELECT COUNT(*) FROM chats", (err, row) => console.log('Total chats:', row));
db.all("SELECT id FROM chats", (err, rows) => console.log('Chat IDs:', rows.map(r=>r.id)));
