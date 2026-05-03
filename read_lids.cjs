const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./kanban.db');
db.all("SELECT id, name, phone FROM chats WHERE id LIKE '%@lid' OR phone LIKE '1054%'", (err, rows) => {
    console.log(JSON.stringify(rows, null, 2));
});
