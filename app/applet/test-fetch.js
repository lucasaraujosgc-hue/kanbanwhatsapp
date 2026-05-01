fetch('http://0.0.0.0:3000/api/test-contact/557591167094@c.us')
  .then(res => res.text())
  .then(console.log)
  .catch(console.error);
