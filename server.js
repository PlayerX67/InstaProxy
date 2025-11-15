const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const cheerio = require('cheerio');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5, // Reduced for resource-intensive operations
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/fetch', limiter);

// Serve static files
app.use(express.static('public'));

// Resource proxy endpoint - serves CSS, images, fonts, etc.
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(buffer);

  } catch (error) {
    console.error('Proxy error for:', url, error.message);
    res.status(500).send('Failed to fetch resource');
  }
});

app.post('/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url || !validator.isURL(url, { require_protocol: true, protocols: ['http', 'https'] })) {
    return res.status(400).json({ error: 'Valid URL is required (with http/https)' });
  }

  // Declare browser ONCE here
  let browser;

  try {
    console.log(`Fetching: ${url}`);
    
    // Remove 'let' here - just assign to the existing variable
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-web-security',
        '--window-size=1280,720'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent and viewport
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

    // Navigate to page
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Get content and rewrite URLs
    let content = await page.content();
    const finalUrl = page.url();
    const title = await page.title();

    await browser.close();
    browser = null; // Clear the reference

    // Rewrite resource URLs (your existing code)
    content = await rewriteResourceUrls(content, finalUrl);

    res.json({
      success: true,
      url: finalUrl,
      title: title,
      content: content,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fetch error:', error);
    
    // Make sure to close browser in error case too
    if (browser) {
      await browser.close();
      browser = null;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch website',
      message: error.message
    });
  }
});

// Function to rewrite all resource URLs
async function rewriteResourceUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  
  // Rewrite CSS links
  $('link[rel="stylesheet"]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (href && !href.startsWith('data:')) {
      const absoluteUrl = new URL(href, base).toString();
      $(elem).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  // Rewrite images
  $('img').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('data:')) {
      const absoluteUrl = new URL(src, base).toString();
      $(elem).attr('src', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  // Rewrite scripts
  $('script[src]').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src && !src.startsWith('data:')) {
      const absoluteUrl = new URL(src, base).toString();
      $(elem).attr('src', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  // Rewrite inline styles with URLs
  $('[style]').each((i, elem) => {
    let style = $(elem).attr('style');
    style = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
      if (!url.startsWith('data:')) {
        const absoluteUrl = new URL(url, base).toString();
        return `url('/proxy?url=${encodeURIComponent(absoluteUrl)}')`;
      }
      return match;
    });
    $(elem).attr('style', style);
  });

  // Update base URL to maintain relative paths
  $('base').remove();
  $('head').prepend(`<base href="${baseUrl}">`);

  return $.html();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 True Browser Rendering Server running on port ${PORT}`);
});
