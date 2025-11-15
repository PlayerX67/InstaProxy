const express = require('express');
const axios = require('axios'); // Replace 'request' with 'axios'
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Main proxy endpoint
app.get('/proxy', async (req, res) => { // Use an async function
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  console.log('Proxying request to:', targetUrl);

  // Set headers to avoid blocking
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity', // Simpler to handle than gzip
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 10000,
    responseType: 'text', // Ensure response is treated as text
    responseEncoding: 'utf8'
  };

  try {
    const response = await axios.get(targetUrl, options); // Use axios to fetch the URL

    // Get content type
    const contentType = response.headers['content-type'] || '';
    
    if (contentType.includes('text/html')) {
      // Parse and rewrite HTML content (your existing cheerio code here)
      const $ = cheerio.load(response.data);
      const baseUrl = new URL(targetUrl).origin;
      
      // ... (Keep all your existing cheerio rewriting code here) ...
      
      // Send the rewritten HTML
      res.set('Content-Type', 'text/html');
      res.send($.html());
      
    } else {
      // For non-HTML content, serve directly
      res.set('Content-Type', contentType);
      res.send(response.data);
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    // Provide more specific error messages based on the error type
    if (error.response) {
      // The request was made and the server responded with a status code outside 2xx
      res.status(error.response.status).send(`Failed to fetch URL: Server responded with status ${error.response.status}`);
    } else if (error.request) {
      // The request was made but no response was received
      res.status(500).send('Failed to fetch URL: No response received from the target server');
    } else {
      // Something happened in setting up the request that triggered an Error
      res.status(500).send(`Failed to fetch URL: ${error.message}`);
    }
  }
});

// ... (Keep your existing /proxy-page and /proxy-resource endpoints, but update them to use axios similarly) ...

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
