const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// Serve static files from public
app.use(express.static('public'));

// Serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Proxy route for /scramjet/* (initial fetch + rewrite)
app.get('/scramjet/*', async (req, res) => {
  try {
    const targetUrl = decodeURIComponent(atob(req.path.split('/scramjet/')[1]));
    if (!targetUrl.startsWith('http')) {
      return res.status(400).send('Invalid URL');
    }

    // Fetch the target with https agent (handles most sites)
    const client = targetUrl.startsWith('https') ? https : http;
    const parsed = new URL(targetUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (targetUrl.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };

    const proxyReq = client.request(options, (proxyRes) => {
      let body = '';
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        let content = body;
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          // Basic HTML rewrite (inspired by Scramjet: prefix all relative URLs)
          const prefix = req.protocol + '://' + req.get('host') + '/scramjet/';
          content = content.replace(/(src|href)=["']([^"']+)["']/g, (match, attr, url) => {
            if (url.startsWith('http')) return match;
            return `${attr}="${prefix}${Buffer.from(url).toString('base64')}"`;
          }).replace(/url\([^)]*\)/g, match => {
            // Simple CSS url rewrite (expandable)
            return match;
          });
          // Inject SW registration script if not present
          if (!content.includes('proxy.sw.js')) {
            content = content.replace('</head>', `<script>if("serviceWorker"in navigator)navigator.serviceWorker.register("/proxy.sw.js",{scope:"/"});</script></head>`);
          }
        }
        res.set('Content-Type', contentType).status(proxyRes.statusCode).send(content);
      });
    });
    proxyReq.on('error', err => res.status(500).send('Fetch error'));
    proxyReq.end();
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).send('Something broke!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
