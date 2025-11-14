const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Basic error handling
app.use((err, req, res, next) => {
  res.status(500).send('Something broke!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
