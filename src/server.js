const express = require('express');
const path = require('path');
const fileURLToPath = require('url');
// import path from 'path';
// import { fileURLToPath } from 'url';

// __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api', (req, res) => {
  res.json({ message: 'Hello World changes'});
});

let server;

// if (import.meta.url === new URL(import.meta.resolve('./server.js')).href) {
//   server = app.listen(port, () => {
//     console.log(`Server is running on port ${port}`);
//   });
// }

if (require.main === module) {
  // If the file is run directly, start the server
  const PORT = process.env.PORT || 5000;
  server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app