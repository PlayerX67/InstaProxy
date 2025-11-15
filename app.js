const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

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
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  console.log('Proxying request to:', targetUrl);

  // Set headers to avoid blocking
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 10000,
    responseType: 'text',
    maxRedirects: 5
  };

  try {
    const response = await axios.get(targetUrl, options);

    // Get content type
    const contentType = response.headers['content-type'] || '';
    
    if (contentType.includes('text/html')) {
      // Parse and rewrite HTML content
      const $ = cheerio.load(response.data);
      const baseUrl = new URL(targetUrl).origin;
      
      // Rewrite all links to go through our proxy
      $('a[href]').each(function() {
        const href = $(this).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, baseUrl).href;
            $(this).attr('href', `/proxy-page?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            console.log('Failed to parse link:', href);
          }
        }
      });
      
      // Rewrite all images
      $('img[src]').each(function() {
        const src = $(this).attr('src');
        if (src) {
          try {
            const absoluteUrl = new URL(src, baseUrl).href;
            $(this).attr('src', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            console.log('Failed to parse image src:', src);
          }
        }
      });
      
      // Rewrite CSS links
      $('link[rel="stylesheet"][href]').each(function() {
        const href = $(this).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, baseUrl).href;
            $(this).attr('href', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            console.log('Failed to parse CSS href:', href);
          }
        }
      });
      
      // Rewrite script sources
      $('script[src]').each(function() {
        const src = $(this).attr('src');
        if (src) {
          try {
            const absoluteUrl = new URL(src, baseUrl).href;
            $(this).attr('src', `/proxy-resource?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            console.log('Failed to parse script src:', src);
          }
        }
      });
      
      // Rewrite form actions
      $('form[action]').each(function() {
        const action = $(this).attr('action');
        if (action) {
          try {
            const absoluteUrl = new URL(action, baseUrl).href;
            $(this).attr('action', `/proxy-page?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {
            console.log('Failed to parse form action:', action);
          }
        }
      });
      
      // Add base tag to handle relative URLs
      if (!$('head base').length) {
        $('head').prepend(`<base href="${baseUrl}/">`);
      }
      
      // Send the rewritten HTML
      res.set('Content-Type', 'text/html');
      res.send($.html());
      
    } else {
      // For non-HTML content, serve directly
      res.set('Content-Type', contentType);
      res.send(response.data);
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (error.response) {
      // The request was made and the server responded with a status code outside 2xx
      res.status(error.response.status).send(`
        <html>
          <body>
            <h1>Error ${error.response.status}</h1>
            <p>Failed to fetch URL: Server responded with status ${error.response.status}</p>
            <p><a href="/">Return to homepage</a></p>
          </body>
        </html>
      `);
    } else if (error.request) {
      // The request was made but no response was received
      res.status(500).send(`
        <html>
          <body>
            <h1>Connection Error</h1>
            <p>Failed to fetch URL: No response received from the target server</p>
            <p><a href="/">Return to homepage</a></p>
          </body>
        </html>
      `);
    } else {
      // Something happened in setting up the request that triggered an Error
      res.status(500).send(`
        <html>
          <body>
            <h1>Proxy Error</h1>
            <p>Failed to fetch URL: ${error.message}</p>
            <p><a href="/">Return to homepage</a></p>
          </body>
        </html>
      `);
    }
  }
});

// Endpoint for linked pages (to maintain navigation)
app.get('/proxy-page', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.redirect('/');
  }
  res.redirect(`/proxy?url=${encodeURIComponent(targetUrl)}`);
});

// Endpoint for resources (images, CSS, JS)
app.get('/proxy-resource', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('No URL provided');
  }

  console.log('Proxying resource:', targetUrl);

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer', // Important for binary data
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Referer': targetUrl
      },
      timeout: 10000
    });

    // Set appropriate content type
    const contentType = response.headers['content-type'];
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    // Set caching headers for resources
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    res.send(response.data);
    
  } catch (error) {
    console.error('Resource proxy error:', error.message);
    
    if (error.response) {
      res.status(error.response.status).send(`Failed to fetch resource: ${error.response.status}`);
    } else if (error.request) {
      res.status(500).send('Failed to fetch resource: No response received');
    } else {
      res.status(500).send(`Failed to fetch resource: ${error.message}`);
    }
  }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Web Proxy'
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).send(`
    <html>
      <body>
        <h1>404 - Not Found</h1>
        <p>The page you are looking for does not exist.</p>
        <p><a href="/">Return to homepage</a></p>
      </body>
    </html>
  `);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).send(`
    <html>
      <body>
        <h1>500 - Internal Server Error</h1>
        <p>Something went wrong on our end.</p>
        <p><a href="/">Return to homepage</a></p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});
