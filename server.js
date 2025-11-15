const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for iframe compatibility
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many requests, please try again later.'
  }
});
app.use('/fetch', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Website Fetcher API'
  });
});

// Main fetch endpoint
app.post('/fetch', async (req, res) => {
  const { url, waitUntil = 'networkidle2', timeout = 30000 } = req.body;

  // Validate URL
  if (!url) {
    return res.status(400).json({ 
      error: 'URL is required',
      example: { "url": "https://example.com" }
    });
  }

  if (!validator.isURL(url, { 
    require_protocol: true,
    protocols: ['http', 'https'] 
  })) {
    return res.status(400).json({ 
      error: 'Invalid URL format. Please include http:// or https://'
    });
  }

  let browser;
  try {
    console.log(`Fetching URL: ${url}`);
    
    // Launch Puppeteer with Render-compatible settings
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );

    // Set viewport to a common desktop size
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate to the page with error handling
    try {
      await page.goto(url, { 
        waitUntil: waitUntil,
        timeout: timeout 
      });
    } catch (navError) {
      console.warn(`Navigation warning for ${url}:`, navError.message);
      // Continue even with navigation timeout - we'll get whatever loaded
    }

    // Wait a bit more for any dynamic content
    await page.waitForTimeout(2000);

    // Get the fully rendered HTML
    const content = await page.content();
    
    // Get the final URL (after redirects)
    const finalUrl = page.url();

    // Extract page title
    const title = await page.title();

    // Close the browser to free memory
    await browser.close();

    // Send successful response
    res.json({
      success: true,
      url: finalUrl,
      title: title,
      content: content,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching website:', error);
    
    // Make sure to close browser if it exists
    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch website',
      message: error.message,
      suggestion: 'The website might be blocking automated requests or taking too long to load.'
    });
  }
});

// Simple fetch endpoint for GET requests (for testing)
app.get('/fetch', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.redirect('/');
  }

  try {
    const response = await fetchWebsite(url);
    res.json(response);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch website',
      message: error.message
    });
  }
});

// Serve the main page for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Website Fetcher Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Helper function for GET endpoint
async function fetchWebsite(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    
    await browser.close();
    
    return {
      success: true,
      content: content,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}
