const sqlite3 = require('sqlite3');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/backup';
let dbPath = path.join(__dirname, 'data', 'kanban.db');
if (require('fs').existsSync(path.join(DATA_DIR, 'kanban.db'))) {
    dbPath = path.join(DATA_DIR, 'kanban.db');
}

const db = new sqlite3.Database(dbPath);
console.log('Using DB at', dbPath);

db.all("SELECT id, name, phone FROM chats WHERE id LIKE '%105%' OR id LIKE '%557591167094%'", (err, rows) => {
  if (err) return console.error(err);
  console.log('CHATS:', rows);
});

db.all("SELECT chat_id, count(*) as c FROM messages GROUP BY chat_id HAVING chat_id LIKE '%105%' OR chat_id LIKE '%557591167094%'", (err, rows) => {
  if (err) return console.error(err);
  console.log('MESSAGES:', rows);
});

db.all("SELECT id, name, phone FROM chats WHERE id LIKE '%lid%'", (err, rows) => {
  if (err) return console.error(err);
  console.log('LID CHATS:', rows);
});
