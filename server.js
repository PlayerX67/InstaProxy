// index.js
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; // Render sets the PORT environment variable[citation:3]

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// API endpoint to fetch and render a website
app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).send('URL parameter is required.');
  }

  let browser;
  try {
    // Launch a headless Chrome browser[citation:1]
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox', // Necessary for some deployment environments
        '--disable-dev-shm-usage'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic viewport
    await page.setViewport({ width: 1366, height: 768 });
    
    // Navigate to the page and wait until the network is idle[citation:4]
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Get the fully rendered HTML content
    const content = await page.content();
    
    // Send the rendered HTML back to the frontend
    res.send(content);
    
  } catch (error) {
    console.error('Error fetching the URL:', error);
    res.status(500).send('Error fetching the website: ' + error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, '0.0.0.0', () => { // Bind to 0.0.0.0 for Render[citation:3]
  console.log(`Server running on port ${PORT}`);
});
