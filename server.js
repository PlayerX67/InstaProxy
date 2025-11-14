import express from 'express';
import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

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

// Store for cached pages and browser instance
const pageCache = new Map();
let browser = null;

// Initialize browser
async function initBrowser() {
  if (!browser) {
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
  }
  return browser;
}

// Validate and sanitize URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Rewrite URLs in HTML to go through proxy
function rewriteUrls(html, originalUrl, proxyBaseUrl) {
  const originalHost = new URL(originalUrl).hostname;
  
  // Rewrite protocol-relative URLs
  html = html.replace(/href="\/\//g, `href="${new URL(originalUrl).protocol}//`);
  html = html.replace(/src="\/\//g, `src="${new URL(originalUrl).protocol}//`);
  
  // Rewrite relative URLs to absolute
  const originalBase = new URL(originalUrl);
  const baseHref = `${originalBase.protocol}//${originalBase.host}`;
  
  // Add base tag if not present
  if (!html.includes('<base')) {
    html = html.replace('</head>', `<base href="${baseHref}/">\n</head>`);
  }
  
  // Rewrite form actions
  html = html.replace(/action="([^"]*?)"/g, (match, actionUrl) => {
    if (actionUrl.startsWith('http')) {
      return `action="${proxyBaseUrl}/api/proxy-request?url=${encodeURIComponent(actionUrl)}"`;
    } else if (actionUrl.startsWith('/')) {
      return `action="${proxyBaseUrl}/api/proxy-request?url=${encodeURIComponent(baseHref + actionUrl)}"`;
    }
    return match;
  });

  // Inject proxy script for XHR/Fetch
  const proxyScript = `
    <script>
      (function() {
        const originalFetch = window.fetch;
        const originalXHR = XMLHttpRequest.prototype.open;
        const proxyBase = '${proxyBaseUrl}';
        
        window.fetch = function(...args) {
          let url = args[0];
          if (typeof url === 'string' && !url.includes('${proxyBaseUrl}')) {
            if (!url.startsWith('http')) {
              url = window.location.origin + (url.startsWith('/') ? '' : '/') + url;
            }
            args[0] = proxyBase + '/api/proxy-request?url=' + encodeURIComponent(url);
          }
          return originalFetch.apply(this, args);
        };

        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          if (typeof url === 'string' && !url.includes('${proxyBaseUrl}')) {
            if (!url.startsWith('http')) {
              url = window.location.origin + (url.startsWith('/') ? '' : '/') + url;
            }
            url = proxyBase + '/api/proxy-request?url=' + encodeURIComponent(url);
          }
          return originalXHR.apply(this, [method, url, ...rest]);
        };
      })();
    </script>
  `;
  
  html = html.replace('</head>', proxyScript + '\n</head>');
  
  return html;
}

// Main interactive rendering endpoint
app.post('/api/render', async (req, res) => {
  const { url, waitUntil = 'networkidle2' } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  let page;
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1920, height: 1080 });

    // Set user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );

    // Request interception to handle all resources
    await page.on('response', async (response) => {
      try {
        await response.buffer();
      } catch (e) {
        // Silently ignore errors
      }
    });

    // Navigate to URL
    await page.goto(url, {
      waitUntil: waitUntil,
      timeout: 30000,
    });

    // Get page metrics
    const metrics = await page.metrics();
    
    // Capture screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    });

    // Get HTML content
    let html = await page.content();
    
    // Rewrite URLs in HTML
    const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
    html = rewriteUrls(html, url, proxyBaseUrl);

    // Get page metadata
    const title = await page.title();
    const finalUrl = page.url();

    const result = {
      success: true,
      title,
      url: finalUrl,
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
    pageCache.set(url, { data: result, timestamp: Date.now() });

    res.json(result);
  } catch (error) {
    console.error('Rendering error:', error);
    res.status(500).json({
      error: 'Failed to render website',
      message: error.message,
    });
  } finally {
    if (page) {
      await page.close();
    }
  }
});

// Proxy endpoint for HTML
app.get('/api/proxy-html', async (req, res) => {
  const { url } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
      validateStatus: () => true,
    });

    let html = response.data;
    const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
    html = rewriteUrls(html, response.request.res.responseUrl || url, proxyBaseUrl);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Proxy HTML error:', error);
    res.status(500).json({
      error: 'Failed to fetch website',
      message: error.message,
    });
  }
});

// Proxy endpoint for all requests (resources, XHR, etc.)
app.all('/api/proxy-request', async (req, res) => {
  const { url } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const config = {
      timeout: 10000,
      headers: {
        ...req.headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'arraybuffer',
    };

    // Remove host header to avoid conflicts
    delete config.headers.host;

    const response = await axios({
      method: req.method.toLowerCase(),
      url,
      data: req.body,
      ...config,
    });

    // Set response headers from proxied request
    res.set('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.set('Cache-Control', response.headers['cache-control'] || 'no-cache');
    res.set('Access-Control-Allow-Origin', '*');

    res.send(response.data);
  } catch (error) {
    console.error('Proxy request error:', error.message);
    res.status(502).json({
      error: 'Failed to proxy request',
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

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
