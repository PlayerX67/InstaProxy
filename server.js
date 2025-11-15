const express = require('express');
const puppeteer = require('puppeteer-extra');
const pluginStealth = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

// Use the stealth plugin
puppeteer.use(pluginStealth());

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/fetch', limiter);

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Advanced Website Fetcher' });
});

// Advanced fetch endpoint
app.post('/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url || !validator.isURL(url, { require_protocol: true, protocols: ['http', 'https'] })) {
    return res.status(400).json({ error: 'Valid URL is required (with http/https)' });
  }

  // Configuration for Puppeteer
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1280,720'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  };

  let browser;
  try {
    console.log(`Launching browser to fetch: ${url}`);
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // 1. Set a realistic, modern User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    // 2. Set extra HTTP headers to mimic a real browser
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
    });

    // 3. Set a realistic viewport
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

    // 4. Block images and stylesheets for faster loading (optional)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 5. Navigate with a longer timeout and wait for network idle
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // 6. Add a random delay to mimic human reading time (2-5 seconds)
    await page.waitForTimeout(2000 + Math.random() * 3000);

    // 7. Get the fully rendered content
    const content = await page.content();
    const finalUrl = page.url();
    const title = await page.title();

    await browser.close();

    res.json({
      success: true,
      url: finalUrl,
      title: title,
      content: content,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Advanced fetch error:', error);
    if (browser) await browser.close();

    let errorMessage = 'Failed to fetch website';
    if (error.message.includes('net::ERR_ABORTED') || error.message.includes('Navigation failed')) {
      errorMessage = 'Website blocked the request or resource was aborted';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Website took too long to load';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      message: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Advanced Website Fetcher running on port ${PORT}`);
});
