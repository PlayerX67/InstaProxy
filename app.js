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
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Debug endpoint to test if server is working
app.get('/debug', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Simple proxy endpoint without complex rewriting
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  console.log('=== PROXY REQUEST START ===');
  console.log('Target URL:', targetUrl);
  
  if (!targetUrl) {
    console.log('ERROR: No URL provided');
    return res.status(400).send(createErrorPage('No URL provided', 'Please enter a website URL'));
  }

  // Validate URL format
  let processedUrl = targetUrl;
  if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
    processedUrl = 'https://' + processedUrl;
  }

  try {
    new URL(processedUrl);
  } catch (error) {
    console.log('ERROR: Invalid URL format');
    return res.status(400).send(createErrorPage('Invalid URL', 'Please enter a valid URL including http:// or https://'));
  }

  try {
    console.log('Fetching URL:', processedUrl);
    
    const response = await axios.get(processedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000,
      responseType: 'text',
      validateStatus: null // Don't throw on HTTP error status codes
    });

    console.log('Response status:', response.status);
    console.log('Content type:', response.headers['content-type']);

    if (response.status !== 200) {
      console.log('ERROR: Non-200 status code:', response.status);
      return res.send(createErrorPage(
        `HTTP Error ${response.status}`,
        `The website returned status code ${response.status}`,
        processedUrl
      ));
    }

    const contentType = response.headers['content-type'] || '';
    
    if (contentType.includes('text/html')) {
      console.log('Processing HTML content...');
      
      try {
        const $ = cheerio.load(response.data);
        const baseUrl = new URL(processedUrl).origin;
        
        // Simple rewriting - just update links
        $('a[href]').each(function() {
          const href = $(this).attr('href');
          if (href && !href.startsWith('javascript:')) {
            try {
              const absoluteUrl = new URL(href, baseUrl).href;
              $(this).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
            } catch (e) {
              // Skip invalid URLs
            }
          }
        });

        // Add base tag
        if (!$('head base').length) {
          $('head').prepend(`<base href="${baseUrl}/">`);
        }

        // Add a style to highlight proxy usage
        $('head').append(`
          <style>
            .proxy-indicator {
              position: fixed;
              top: 10px;
              right: 10px;
              background: rgba(0,0,0,0.7);
              color: white;
              padding: 5px 10px;
              border-radius: 4px;
              font-size: 12px;
              z-index: 10000;
            }
          </style>
        `);
        
        $('body').prepend(`<div class="proxy-indicator">🔒 Proxied</div>`);

        const finalHtml = $.html();
        console.log('Successfully processed HTML');
        
        res.set('Content-Type', 'text/html');
        res.send(finalHtml);
        
      } catch (parseError) {
        console.log('ERROR: HTML parsing failed:', parseError.message);
        // Send original content if parsing fails
        res.set('Content-Type', 'text/html');
        res.send(response.data);
      }
    } else {
      console.log('Serving non-HTML content directly');
      res.set('Content-Type', contentType);
      res.send(response.data);
    }

  } catch (error) {
    console.log('ERROR: Request failed:', error.message);
    
    let errorMessage = 'Failed to load the website';
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Website not found. Check the URL and try again.';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused. The website may be blocking proxy requests.';
    } else if (error.response) {
      errorMessage = `Website returned error: ${error.response.status}`;
    } else if (error.request) {
      errorMessage = 'No response received from the website';
    }

    res.send(createErrorPage('Proxy Error', errorMessage, processedUrl));
  }
  
  console.log('=== PROXY REQUEST END ===');
});

// Create error page HTML
function createErrorPage(title, message, url = '') {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title}</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                padding: 40px; 
                text-align: center; 
                color: #333;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .error-container {
                max-width: 500px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 15px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            }
            h1 {
                color: #e74c3c;
                margin-bottom: 20px;
            }
            p {
                margin: 15px 0;
                line-height: 1.6;
            }
            .url {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                word-break: break-all;
            }
            .btn {
                display: inline-block;
                padding: 10px 20px;
                background: #3498db;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <h1>❌ ${title}</h1>
            <p>${message}</p>
            ${url ? `<p>URL: <span class="url">${url}</span></p>` : ''}
            <a href="javascript:history.back()" class="btn">Go Back</a>
            <a href="/" class="btn" style="background: #2c3e50; margin-left: 10px;">Home</a>
        </div>
    </body>
    </html>
  `;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Web Proxy'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🔍 Debug: http://localhost:${PORT}/debug`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});
