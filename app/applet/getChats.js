const http = require('http');

http.get('http://localhost:3000/api/chats', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(data));
});
