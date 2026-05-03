const http = require('http');
http.get('http://127.0.0.1:3000/api/export', (res) => {
  res.on('data', () => {});
  console.log(res.statusCode);
});
