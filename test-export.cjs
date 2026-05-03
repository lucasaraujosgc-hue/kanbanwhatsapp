const http = require('http');
http.get('http://127.0.0.1:3000/api/export', (res) => {
  console.log('Export Status:', res.statusCode);
  console.log('Headers:', res.headers);
});
