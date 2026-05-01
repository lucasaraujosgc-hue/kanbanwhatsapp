import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('/backup/kanban.db');
db.all('SELECT id FROM chats LIMIT 5', (err, rows) => {
  console.log(rows);
});
