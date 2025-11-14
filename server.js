import express from 'express';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';
import fetch from 'node-fetch';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

let browser = null;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

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
        '--disable-extensions',
        '--disable-blink-features=AutomationControlled',
      ],
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

// Main proxy route - serves rendered HTML directly
app.get('/fetch*', async (req, res) => {
  let urlParam = req.query.url;
  
  if (!urlParam) {
    // Extract from path if using /fetch/url format
    const pathParts = req.path.substring(7); // Remove '/fetch/'
    if (pathParts) {
      try {
        urlParam = Buffer.from(decodeURIComponent(pathParts), 'base64').toString();
      } catch (e) {
        // fallback
      }
    }
  }

  if (!urlParam || !isValidUrl(urlParam)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let page;
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
    });

    // Enable request interception to handle all requests
    await page.on('request', async (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // Block unnecessary resources
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        request.abort();
        return;
      }

      try {
        await request.continue();
      } catch (e) {
        // Request may have been intercepted by other handlers
      }
    });

    // Navigate to the URL
    await page.goto(urlParam, {
      waitUntil: ['networkidle2', 'domcontentloaded'],
      timeout: 45000,
    });

    // Wait for dynamic content
    await page.evaluate(() => {
      return new Promise(resolve => {
        setTimeout(resolve, 3000);
      });
    });

    // Remove tracking and analytics
    await page.evaluate(() => {
      // Remove scripts that might track or interfere
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        if (script.src && (
          script.src.includes('analytics') ||
          script.src.includes('gtag') ||
          script.src.includes('facebook') ||
          script.src.includes('hotjar')
        )) {
          script.remove();
        }
      });

      // Remove meta tags that might cause redirects
      const metas = document.querySelectorAll('meta[http-equiv="refresh"]');
      metas.forEach(meta => meta.remove());
    });

    // Get the rendered HTML
    let html = await page.content();

    // Inject script to handle navigation through proxy
    const proxyScript = `
<script>
(function() {
  const originalUrl = '${urlParam.replace(/'/g, "\\'")}';
  const fetchPrefix = '/fetch?url=';
  
  // Intercept link clicks
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (link) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('#')) {
        e.preventDefault();
        try {
          const targetUrl = new URL(href, originalUrl).href;
          window.location.href = fetchPrefix + encodeURIComponent(targetUrl);
        } catch (err) {
          console.error('Navigation error:', err);
        }
      }
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.method.toUpperCase() === 'GET' && form.action) {
      e.preventDefault();
      try {
        const targetUrl = new URL(form.action + '?' + new FormData(form), originalUrl).href;
        window.location.href = fetchPrefix + encodeURIComponent(targetUrl);
      } catch (err) {
        console.error('Form submission error:', err);
      }
    }
  }, true);

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = function(resource, init = {}) {
    let url = typeof resource === 'string' ? resource : resource.url;
    
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const targetUrl = new URL(url, originalUrl).href;
        url = fetchPrefix + encodeURIComponent(targetUrl);
        
        if (typeof resource === 'string') {
          return originalFetch(url, init);
        } else {
          return originalFetch(new Request(url, resource), init);
        }
      } catch (err) {
        return originalFetch(resource, init);
      }
    }
    return originalFetch(resource, init);
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const targetUrl = new URL(url, originalUrl).href;
        const proxyUrl = fetchPrefix + encodeURIComponent(targetUrl);
        return originalOpen.call(this, method, proxyUrl, ...args);
      } catch (err) {
        return originalOpen.call(this, method, url, ...args);
      }
    }
    return originalOpen.call(this, method, url, ...args);
  };
})();
</script>
`;

    // Remove CSP headers
    html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
    html = html.replace(/<meta[^>]+name=["']?theme-color["']?[^>]*>/gi, '');

    // Inject script before closing body
    if (html.includes('</body>')) {
      html = html.replace('</body>', proxyScript + '</body>');
    } else {
      html = html + proxyScript;
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(html);

  } catch (error) {
    console.error('Fetch error:', error.message);
    res.status(500).set('Content-Type', 'text/html').send(`
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; background: #f5f5f5; }
    .error { background: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto; }
    h1 { color: #d32f2f; margin: 0 0 20px 0; }
    p { margin: 10px 0; color: #666; }
    a { color: #4285f4; text-decoration: none; }
  </style>
</head>
<body>
  <div class="error">
    <h1>❌ Error Loading Page</h1>
    <p><strong>${error.message}</strong></p>
    <p><a href="/">← Go Back</a></p>
  </div>
</body>
</html>
    `);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Website Fetcher running on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
