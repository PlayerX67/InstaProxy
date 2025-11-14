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

// User agents for different browser scenarios
const USER_AGENTS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
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
        '--disable-blink-features=AutomationControlled',
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

// Convert relative URL to absolute
function resolveUrl(relativeUrl, baseUrl) {
  if (!relativeUrl) return baseUrl;
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  
  const base = new URL(baseUrl);
  if (relativeUrl.startsWith('//')) {
    return base.protocol + relativeUrl;
  }
  if (relativeUrl.startsWith('/')) {
    return base.protocol + '//' + base.host + relativeUrl;
  }
  
  return base.protocol + '//' + base.host + base.pathname.replace(/\/[^/]*$/, '/') + relativeUrl;
}

// Rewrite URLs in HTML to go through proxy
function rewriteUrls(html, originalUrl, proxyBaseUrl) {
  const originalHost = new URL(originalUrl).hostname;
  
  // Add base tag for relative URL resolution
  const baseTag = `<base href="${originalUrl}">`;
  if (!html.includes('<base')) {
    html = html.replace(/<head[^>]*>/i, (match) => {
      return match + '\n' + baseTag;
    });
    if (!html.includes('<head')) {
      html = baseTag + html;
    }
  }
  
  // Rewrite script src
  html = html.replace(/(<script[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, srcUrl, suffix) => {
    if (srcUrl.includes('blob:') || srcUrl.includes('data:')) return match;
    const resolved = resolveUrl(srcUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite link href
  html = html.replace(/(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, hrefUrl, suffix) => {
    if (hrefUrl.includes('blob:') || hrefUrl.includes('data:')) return match;
    const resolved = resolveUrl(hrefUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite img src
  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, imgUrl, suffix) => {
    if (imgUrl.includes('blob:') || imgUrl.includes('data:')) return match;
    const resolved = resolveUrl(imgUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite source src (for video/audio)
  html = html.replace(/(<source[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, sourceUrl, suffix) => {
    if (sourceUrl.includes('blob:') || sourceUrl.includes('data:')) return match;
    const resolved = resolveUrl(sourceUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite form action
  html = html.replace(/(<form[^>]+action=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, actionUrl, suffix) => {
    const resolved = resolveUrl(actionUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-request?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite iframe src
  html = html.replace(/(<iframe[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, iframeUrl, suffix) => {
    if (iframeUrl.includes('blob:') || iframeUrl.includes('data:')) return match;
    const resolved = resolveUrl(iframeUrl, originalUrl);
    return `${prefix}${proxyBaseUrl}/api/proxy-html?url=${encodeURIComponent(resolved)}${suffix}`;
  });

  // Rewrite inline styles with url()
  html = html.replace(/url\(["']?(?!(?:blob|data):)([^"')]+)["']?\)/gi, (match, styleUrl) => {
    const resolved = resolveUrl(styleUrl, originalUrl);
    return `url(${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)})`;
  });

  // Remove CSP headers
  html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

  // Inject comprehensive proxy script
  const proxyScript = `
    <script>
      (function() {
        const proxyBase = '${proxyBaseUrl}';
        const originalUrl = '${originalUrl.replace(/'/g, "\\'")}';
        
        // Override fetch
        const originalFetch = window.fetch;
        window.fetch = function(resource, config = {}) {
          let url = typeof resource === 'string' ? resource : resource.url;
          
          if (url && typeof url === 'string' && !url.includes(proxyBase) && !url.startsWith('blob:') && !url.startsWith('data:')) {
            try {
              const resolved = new URL(url, originalUrl).href;
              if (!resolved.includes(proxyBase)) {
                url = proxyBase + '/api/proxy-asset?url=' + encodeURIComponent(resolved);
              }
            } catch (e) {
              console.warn('Failed to resolve URL:', url, e);
            }
          }
          
          if (typeof resource === 'string') {
            return originalFetch(url, config);
          } else {
            return originalFetch(Object.assign(new Request(url), resource), config);
          }
        };

        // Override XMLHttpRequest
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          if (url && typeof url === 'string' && !url.includes(proxyBase) && !url.startsWith('blob:') && !url.startsWith('data:')) {
            try {
              const resolved = new URL(url, originalUrl).href;
              if (!resolved.includes(proxyBase)) {
                url = proxyBase + '/api/proxy-asset?url=' + encodeURIComponent(resolved);
              }
            } catch (e) {
              console.warn('Failed to resolve URL:', url, e);
            }
          }
          return originalOpen.apply(this, [method, url, ...rest]);
        };

        // Handle relative links
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a[href]');
          if (link && link.href) {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('#')) {
              try {
                const resolved = new URL(href, originalUrl).href;
                if (!resolved.includes(proxyBase) && (resolved.startsWith('http://') || resolved.startsWith('https://'))) {
                  e.preventDefault();
                  window.location.href = proxyBase + '/api/proxy-html?url=' + encodeURIComponent(resolved);
                }
              } catch (e) {
                console.warn('Failed to handle link:', href, e);
              }
            }
          }
        }, true);

        // Block form submissions to external sites
        document.addEventListener('submit', function(e) {
          const form = e.target;
          const action = form.getAttribute('action');
          if (action && !action.includes(proxyBase) && !action.startsWith('javascript:')) {
            try {
              const resolved = new URL(action, originalUrl).href;
              form.action = proxyBase + '/api/proxy-request?url=' + encodeURIComponent(resolved);
            } catch (e) {
              console.warn('Failed to handle form:', action, e);
            }
          }
        }, true);
      })();
    </script>
  `;
  
  if (html.includes('</head>')) {
    html = html.replace('</head>', proxyScript + '\n</head>');
  } else {
    html = proxyScript + html;
  }
  
  return html;
}

// Main rendering endpoint
app.post('/api/render', async (req, res) => {
  const { url, waitUntil = 'networkidle2', userAgent = 'chrome' } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  let page;
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    const ua = USER_AGENTS[userAgent] || USER_AGENTS.chrome;
    await page.setUserAgent(ua);

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });

    try {
      await page.goto(url, {
        waitUntil: waitUntil,
        timeout: 30000,
      });
    } catch (navError) {
      console.warn('Navigation error (non-fatal):', navError.message);
    }

    try {
      await page.waitForTimeout(2000);
    } catch (e) {
      // Ignore
    }

    const metrics = await page.metrics();
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    let html = await page.content();
    
    const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
    html = rewriteUrls(html, url, proxyBaseUrl);

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

// Proxy HTML endpoint
app.get('/api/proxy-html', async (req, res) => {
  const { url } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': new URL(url).origin + '/',
      },
      maxRedirects: 10,
      validateStatus: () => true,
      decompress: true,
    });

    let html = response.data;
    const finalUrl = response.request.res.responseUrl || url;
    const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
    
    html = rewriteUrls(html, finalUrl, proxyBaseUrl);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(html);
  } catch (error) {
    console.error('Proxy HTML error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch website',
      message: error.message,
    });
  }
});

// Proxy assets
app.get('/api/proxy-asset', async (req, res) => {
  const { url } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
      },
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      decompress: true,
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Content-Type-Options', 'nosniff');
    
    // Rewrite CSS
    if (contentType.includes('text/css')) {
      let css = Buffer.from(response.data).toString('utf-8');
      const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
      
      css = css.replace(/url\(["']?(?!(?:blob|data|http):)([^"')]+)["']?\)/gi, (match, styleUrl) => {
        try {
          const resolved = new URL(styleUrl, url).href;
          return `url(${proxyBaseUrl}/api/proxy-asset?url=${encodeURIComponent(resolved)})`;
        } catch (e) {
          return match;
        }
      });
      
      res.send(Buffer.from(css));
    } else {
      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy asset error:', error.message);
    res.status(502).set('Content-Type', 'application/json').json({
      error: 'Failed to proxy asset',
      message: error.message,
    });
  }
});

// Proxy requests (forms, XHR)
app.all('/api/proxy-request', async (req, res) => {
  const { url } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const config = {
      timeout: 10000,
      headers: {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      maxRedirects: 5,
      validateStatus: () => true,
    };

    const forwardHeaders = ['content-type', 'content-length'];
    forwardHeaders.forEach(header => {
      if (req.headers[header]) {
        config.headers[header] = req.headers[header];
      }
    });

    const response = await axios({
      method: req.method.toLowerCase(),
      url,
      data: req.body,
      ...config,
      responseType: 'arraybuffer',
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    
    if (contentType.includes('text/html')) {
      let html = Buffer.from(response.data).toString('utf-8');
      const finalUrl = response.request.res.responseUrl || url;
      const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
      html = rewriteUrls(html, finalUrl, proxyBaseUrl);
      res.send(html);
    } else {
      res.send(response.data);
    }
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

// Serve index.html
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
