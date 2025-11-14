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
};

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourceSharing: true,
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = new Map();

function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Create session for proxying
app.post('/api/create-session', (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const sessionId = Math.random().toString(36).substring(2, 15);
  sessionStore.set(sessionId, {
    targetUrl: url,
    createdAt: Date.now(),
  });

  // Clean up old sessions
  if (sessionStore.size > 100) {
    for (const [key, value] of sessionStore) {
      if (Date.now() - value.createdAt > 3600000) {
        sessionStore.delete(key);
      }
    }
  }

  res.json({ sessionId });
});

// Main proxy endpoint
app.get('/proxy/:sessionId*', async (req, res) => {
  const { sessionId } = req.params;
  const pathSuffix = req.params[0] || '';
  
  const session = sessionStore.get(sessionId);
  if (!session) {
    return res.status(404).send('<h1>Session not found</h1>');
  }

  const baseUrl = session.targetUrl;
  let targetUrl = baseUrl;

  // Handle path suffix
  if (pathSuffix && pathSuffix !== '/') {
    try {
      targetUrl = new URL(pathSuffix.startsWith('/') ? pathSuffix : '/' + pathSuffix, baseUrl).href;
    } catch (e) {
      targetUrl = baseUrl;
    }
  }

  // Handle query string
  if (req.url.includes('?')) {
    const queryString = req.url.substring(req.url.indexOf('?'));
    targetUrl = targetUrl.split('?')[0] + queryString;
  }

  console.log(`Proxying: ${targetUrl}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': baseUrl,
        ...(req.headers.cookie && { 'Cookie': req.headers.cookie }),
      },
      timeout: 30000,
      maxRedirects: 10,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      decompress: true,
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const statusCode = response.status || 200;

    // Copy response headers
    res.status(statusCode);
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (response.headers['set-cookie']) {
      res.set('Set-Cookie', response.headers['set-cookie']);
    }

    // Process HTML
    if (contentType.includes('text/html')) {
      let html = Buffer.from(response.data).toString('utf-8');

      // Remove CSP and X-Frame-Options
      html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
      html = html.replace(/<meta[^>]+name=["']?theme-color["']?[^>]*>/gi, '');

      // Inject the proxy script before closing body
      const proxyScript = `
<script>
(function() {
  const baseUrl = '${baseUrl.replace(/'/g, "\\'")}';
  const sessionId = '${sessionId}';
  const proxyPrefix = '/proxy/' + sessionId;

  // Intercept all link clicks
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (link && link.href) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('#')) {
        e.preventDefault();
        try {
          const resolved = new URL(href, baseUrl).href;
          const proxyUrl = proxyPrefix + '/' + encodeURIComponent(resolved);
          window.location.href = proxyUrl;
        } catch (err) {
          console.error('Failed to resolve URL:', err);
        }
      }
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      try {
        const resolved = new URL(form.action, baseUrl).href;
        const proxyUrl = proxyPrefix + '/' + encodeURIComponent(resolved);
        form.action = proxyUrl;
      } catch (err) {
        console.error('Failed to resolve form action:', err);
      }
    }
  }, true);

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function(resource, init = {}) {
    let url = typeof resource === 'string' ? resource : resource.url;
    
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const resolved = new URL(url, baseUrl).href;
        const proxyUrl = proxyPrefix + '/' + encodeURIComponent(resolved);
        
        if (typeof resource === 'string') {
          return origFetch(proxyUrl, init);
        } else {
          const newResource = new Request(proxyUrl, resource);
          return origFetch(newResource, init);
        }
      } catch (err) {
        console.error('Fetch error:', err);
        return origFetch(resource, init);
      }
    }
    return origFetch(resource, init);
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const resolved = new URL(url, baseUrl).href;
        const proxyUrl = proxyPrefix + '/' + encodeURIComponent(resolved);
        return origOpen.call(this, method, proxyUrl, ...args);
      } catch (err) {
        console.error('XHR error:', err);
        return origOpen.call(this, method, url, ...args);
      }
    }
    return origOpen.call(this, method, url, ...args);
  };
})();
</script>
`;

      if (html.includes('</body>')) {
        html = html.replace('</body>', proxyScript + '</body>');
      } else {
        html = html + proxyScript;
      }

      res.send(html);
    } else {
      // For non-HTML, send as-is
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(502).send(`
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial; padding: 40px; background: #f5f5f5; }
    .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #d32f2f; margin: 0 0 10px 0; }
    p { margin: 5px 0; color: #666; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="error">
    <h1>❌ Proxy Error</h1>
    <p><strong>URL:</strong> <code>${targetUrl}</code></p>
    <p><strong>Error:</strong> ${error.message}</p>
    <p><a href="/">← Go Back</a></p>
  </div>
</body>
</html>
    `);
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

process.on('SIGTERM', () => process.exit(0));
