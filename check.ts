import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('./data/kanban.db');
db.all("SELECT id, name, phone FROM chats", (err, rows) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(rows, null, 2));
});
