const express = require('express');
const request = require('request');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Main proxy endpoint
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  console.log('Proxying request to:', targetUrl);

  // Set headers to avoid blocking
  const options = {
    url: targetUrl,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    gzip: true,
    timeout: 10000
  };

  request.get(options, (error, response, body) => {
    if (error) {
      console.error('Proxy error:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch URL', 
        message: error.message 
      });
    }

    if (response.statusCode !== 200) {
      console.error('HTTP Error:', response.statusCode);
      return res.status(response.statusCode).json({
        error: `HTTP Error: ${response.statusCode}`,
        message: 'The website returned an error'
      });
    }

    // Get content type
    const contentType = response.headers['content-type'] || '';
    
    if (contentType.includes('text/html')) {
      // Parse and rewrite HTML content
      try {
        const $ = cheerio.load(body);
        const baseUrl = new URL(targetUrl).origin;
        
        // Rewrite all links to go through our proxy
        $('a[href]').each(function() {
          const href = $(this).attr('href');
          if (href) {
            const absoluteUrl = new URL(href, baseUrl).href;
            $(this).attr('href', `/proxy-page?url=${encodeURIComponent(absoluteUrl)}`);
          }
        });
        
        // Rewrite all images
        $('img[src]').each(function() {
          const src = $(this).attr('src');
          if (src) {
            const absoluteUrl = new URL(src, baseUrl).href;
            $(this).attr('src', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          }
        });
        
        // Rewrite CSS links
        $('link[rel="stylesheet"][href]').each(function() {
          const href = $(this).attr('href');
          if (href) {
            const absoluteUrl = new URL(href, baseUrl).href;
            $(this).attr('href', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          }
        });
        
        // Rewrite script sources
        $('script[src]').each(function() {
          const src = $(this).attr('src');
          if (src) {
            const absoluteUrl = new URL(src, baseUrl).href;
            $(this).attr('src', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          }
        });
        
        // Add base tag to handle relative URLs
        if (!$('head base').length) {
          $('head').prepend(`<base href="${baseUrl}/">`);
        }
        
        // Send the rewritten HTML
        res.set('Content-Type', 'text/html');
        res.send($.html());
        
      } catch (parseError) {
        console.error('HTML parsing error:', parseError);
        res.set('Content-Type', 'text/html');
        res.send(body); // Send original content if parsing fails
      }
    } else {
      // For non-HTML content, serve directly
      res.set('Content-Type', contentType);
      res.send(body);
    }
  });
});

// Endpoint for linked pages (to maintain navigation)
app.get('/proxy-page', (req, res) => {
  res.redirect(`/proxy?url=${encodeURIComponent(req.query.url)}`);
});

// Endpoint for resources (images, CSS, JS)
app.get('/proxy-resource', (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('No URL provided');
  }

  console.log('Proxying resource:', targetUrl);

  const options = {
    url: targetUrl,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': '*/*',
      'Referer': targetUrl
    },
    encoding: null // Get binary data
  };

  request.get(options)
    .on('error', (error) => {
      console.error('Resource proxy error:', error);
      res.status(500).send('Failed to fetch resource');
    })
    .pipe(res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
});
