const express = require('express');
const Unblocker = require('unblocker');
const path = require('path');

const app = express();

const unblocker = new Unblocker({
  prefix: '/proxy/'
});

app.use(unblocker);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});

server.on('upgrade', unblocker.onUpgrade);
