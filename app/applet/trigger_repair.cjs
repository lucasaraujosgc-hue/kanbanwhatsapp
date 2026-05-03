const http = require('http');

const req = http.request('http://localhost:3000/api/repair-names', { method: 'POST' }, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
req.end();
