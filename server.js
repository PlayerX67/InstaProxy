const express = require('express');
const { chromium } = require('playwright');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files (your frontend HTML, CSS, JS)
app.use(express.static('public'));

// API endpoint to fetch and render a website
app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('URL parameter is required');
  }

  let browser;
  try {
    // Launch a headless browser instance
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Needed for deployment on some platforms
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the requested URL and wait for the page to be fully loaded
    await page.goto(url, { waitUntil: 'networkidle' }); // Waits until no new network requests are made for 500ms

    // Get the fully rendered HTML of the page
    const content = await page.content();
    
    // Send the HTML back to the frontend
    res.send(content);

  } catch (error) {
    console.error('Error fetching the URL:', error);
    res.status(500).send('Error fetching the website: ' + error.message);
  } finally {
    // Always close the browser to free up resources
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
