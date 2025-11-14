const express = require('express');
const Unblocker = require('unblocker');
const path = require('path');

const app = express();
const unblocker = new Unblocker({
  prefix: '/proxy/',
  requestMiddleware: [],
  responseMiddleware: []
});

app.use(unblocker);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Route for the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${server.address().port}`);
});

// Handle WebSocket upgrades
server.on('upgrade', unblocker.onUpgrade);
