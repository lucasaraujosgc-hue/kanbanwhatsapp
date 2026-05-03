const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('kanban.db');
db.all('SELECT id, name, phone FROM chats LIMIT 10', (err, rows) => {
  console.log(rows);
});
