import express from 'express';
import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourceSharing: true,
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store for cached renderings
const renderCache = new Map();

// Validate and sanitize URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Main rendering endpoint
app.post('/api/render', async (req, res) => {
  const { url, fullPage = true, waitUntil = 'networkidle2' } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Check cache
  const cacheKey = `${url}-${fullPage}`;
  if (renderCache.has(cacheKey)) {
    return res.json(renderCache.get(cacheKey));
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-extensions',
      ],
      timeout: 30000,
    });

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1920, height: 1080 });

    // Set user agent to avoid being blocked
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );

    // Set headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Handle errors
    page.on('error', (err) => console.error('Page error:', err));

    // Navigate to URL
    await page.goto(url, {
      waitUntil: waitUntil,
      timeout: 30000,
    });

    // Inject CSS to improve rendering consistency
    await page.addStyleTag({
      content: `
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body { margin: 0; padding: 0; }
      `,
    });

    // Get page metrics
    const metrics = await page.metrics();
    
    // Capture screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: fullPage,
    });

    // Get HTML content
    const html = await page.content();

    // Get page title and metadata
    const title = await page.title();
    const url_final = page.url();

    const result = {
      success: true,
      title,
      url: url_final,
      screenshot: screenshot.toString('base64'),
      html,
      metrics: {
        JSHeapUsedSize: metrics.JSHeapUsedSize,
        JSHeapTotalSize: metrics.JSHeapTotalSize,
        TaskDuration: metrics.TaskDuration,
        ScriptDuration: metrics.ScriptDuration,
      },
    };

    // Cache result for 1 hour
    renderCache.set(cacheKey, result);
    setTimeout(() => renderCache.delete(cacheKey), 3600000);

    res.json(result);
  } catch (error) {
    console.error('Rendering error:', error);
    res.status(500).json({
      error: 'Failed to render website',
      message: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Proxy endpoint for full website with iframe
app.post('/api/proxy', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      maxRedirects: 5,
    });

    res.json({
      success: true,
      html: response.data,
      contentType: response.headers['content-type'],
      url: response.request.res.responseUrl || url,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch website',
      message: error.message,
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Website Fetcher running on http://localhost:${PORT}`);
});