const http = require('http');
const fs = require('fs');

console.log('Iniciando exportação...');
const file = fs.createWriteStream('whatskanban_export.zip');

http.get('http://127.0.0.1:3000/api/export', (res) => {
  if (res.statusCode !== 200) {
    console.error(`Falha na exportação. Status da resposta: ${res.statusCode}`);
    res.resume();
    return;
  }

  res.pipe(file);

  file.on('finish', () => {
    file.close();
    console.log('Exportação concluída com sucesso. Arquivo salvo como whatskanban_export.zip');
  });
}).on('error', (err) => {
  fs.unlink('whatskanban_export.zip', () => {});
  console.error('Erro ao realizar o download:', err.message);
});
