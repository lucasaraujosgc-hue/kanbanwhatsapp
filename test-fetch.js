fetch('http://127.0.0.1:3000/api/test-contact/557591167094@c.us', { headers: { 'x-app-password': process.env.PASSWORD || '' } })
  .then(res => res.text())
  .then(console.log)
  .catch(console.error);
