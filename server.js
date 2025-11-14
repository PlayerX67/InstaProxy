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

const USER_AGENTS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourceSharing: true,
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pageCache = new Map();
let browser = null;

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
        '--disable-blink-features=AutomationControlled',
      ],
      timeout: 30000,
    });
  }
  return browser;
}

function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Render endpoint (screenshot only)
app.post('/api/render', async (req, res) => {
  const { url, waitUntil = 'networkidle2' } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  let page;
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(USER_AGENTS.chrome);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'DNT': '1',
    });

    try {
      await page.goto(url, {
        waitUntil: waitUntil,
        timeout: 30000,
      });
    } catch (navError) {
      console.warn('Navigation warning:', navError.message);
    }

    async function waitForDelay(page, ms) {
      return page.evaluate((delay) => {
        return new Promise(resolve => setTimeout(resolve, delay));
      }, ms);
    }

// Then use it as:
await waitForDelay(page, 2000);

// Then use it as:
await waitForDelay(page, 2000);

    const metrics = await page.metrics();
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const title = await page.title();
    const finalUrl = page.url();

    const result = {
      success: true,
      title,
      url: finalUrl,
      screenshot: screenshot.toString('base64'),
      metrics: {
        JSHeapUsedSize: metrics.JSHeapUsedSize,
        JSHeapTotalSize: metrics.JSHeapTotalSize,
      },
    };

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

// Full page viewing via redirect
app.post('/api/open-page', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Store URL in session/memory for the proxy to use
  const sessionId = Math.random().toString(36).substring(7);
  pageCache.set(sessionId, {
    targetUrl: url,
    timestamp: Date.now(),
  });

  // Return redirect to our proxy
  res.json({
    success: true,
    proxyUrl: `/view/${sessionId}`,
  });
});

// Proxy view endpoint - serves the actual site
app.get('/view/:sessionId/*', async (req, res) => {
  const { sessionId } = req.params;
  const session = pageCache.get(sessionId);

  if (!session) {
    return res.status(404).send('Session not found or expired');
  }

  const baseUrl = session.targetUrl;
  const pathSuffix = req.params[0] || '';
  const targetUrl = pathSuffix 
    ? new URL(pathSuffix.startsWith('/') ? pathSuffix : '/' + pathSuffix, baseUrl).href
    : baseUrl;

  try {
    const config = {
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      maxRedirects: 10,
      validateStatus: () => true,
    };

    // Forward cookies if they exist
    if (req.headers.cookie) {
      config.headers['Cookie'] = req.headers.cookie;
    }

    const response = await axios({
      method: 'GET',
      url: targetUrl,
      ...config,
      responseType: 'arraybuffer',
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const statusCode = response.status || 200;

    // Set response headers
    res.status(statusCode);
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Handle cookies from target
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      res.set('Set-Cookie', setCookie);
    }

    // If HTML, inject proxy script
    if (contentType.includes('text/html')) {
      let html = Buffer.from(response.data).toString('utf-8');

      // Remove CSP headers
      html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

      // Inject script that rewrites all URLs client-side
      const injectionScript = `
        <script>
          (function() {
            const baseUrl = '${baseUrl.replace(/'/g, "\\'")}';
            const sessionId = '${sessionId}';
            const proxyBase = '/view/' + sessionId;

            // Replace all hrefs
            document.querySelectorAll('a[href]').forEach(a => {
              const href = a.getAttribute('href');
              if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('#')) {
                try {
                  const resolved = new URL(href, baseUrl).href;
                  if (resolved.startsWith('http')) {
                    a.href = proxyBase + '/' + encodeURIComponent(resolved);
                  }
                } catch (e) {}
              }
            });

            // Intercept fetch
            const origFetch = window.fetch;
            window.fetch = function(resource, config = {}) {
              let url = typeof resource === 'string' ? resource : resource.url;
              if (url && !url.includes(proxyBase) && !url.startsWith('blob:') && !url.startsWith('data:')) {
                try {
                  const resolved = new URL(url, baseUrl).href;
                  url = proxyBase + '/' + encodeURIComponent(resolved);
                } catch (e) {}
              }
              if (typeof resource === 'string') {
                return origFetch(url, config);
              } else {
                return origFetch(Object.assign(new Request(url), resource), config);
              }
            };

            // Intercept XHR
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              if (url && !url.includes(proxyBase) && !url.startsWith('blob:') && !url.startsWith('data:')) {
                try {
                  const resolved = new URL(url, baseUrl).href;
                  url = proxyBase + '/' + encodeURIComponent(resolved);
                } catch (e) {}
              }
              return origOpen.apply(this, [method, url, ...rest]);
            };

            // Handle form submissions
            document.addEventListener('submit', function(e) {
              const form = e.target;
              const action = form.getAttribute('action');
              if (action && !action.includes(proxyBase)) {
                try {
                  const resolved = new URL(action, baseUrl).href;
                  form.action = proxyBase + '/' + encodeURIComponent(resolved);
                } catch (e) {}
              }
            }, true);
          })();
        </script>
      `;

      // Inject before closing head
      if (html.includes('</head>')) {
        html = html.replace('</head>', injectionScript + '</head>');
      } else {
        html = injectionScript + html;
      }

      res.send(html);
    } else {
      // For non-HTML content, just proxy it through
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(502).send(`
      <html>
      <head><title>Proxy Error</title></head>
      <body style="font-family: monospace; padding: 20px;">
        <h1>❌ Proxy Error</h1>
        <p><strong>Target URL:</strong> ${targetUrl}</p>
        <p><strong>Error:</strong> ${error.message}</p>
        <a href="/">← Go Back</a>
      </body>
      </html>
    `);
  }
});

// Asset proxy for static content
app.get('/asset/:sessionId/*', async (req, res) => {
  const { sessionId } = req.params;
  const session = pageCache.get(sessionId);

  if (!session) {
    return res.status(404).send('Session not found');
  }

  const baseUrl = session.targetUrl;
  const pathSuffix = req.params[0] || '';
  const targetUrl = pathSuffix 
    ? new URL(pathSuffix.startsWith('/') ? pathSuffix : '/' + pathSuffix, baseUrl).href
    : baseUrl;

  try {
    const response = await axios.get(targetUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': '*/*',
        'DNT': '1',
      },
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'arraybuffer',
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (error) {
    console.error('Asset proxy error:', error.message);
    res.status(502).send('Failed to load asset');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Website Fetcher running on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
