const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.all("SELECT id, name, phone FROM chats LIMIT 10", (err, rows) => {
  if (err) console.error(err);
  console.log(rows);
});
