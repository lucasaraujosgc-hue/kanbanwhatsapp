import http from 'http';

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/repair-names',
  method: 'POST',
  headers: {
    'x-app-password': process.env.PASSWORD || ''
  }
}, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(data));
});
req.on('error', console.error);
req.end();
