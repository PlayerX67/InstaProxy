// server.js
import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import redis from 'redis';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;

// Proxy configuration class
class ProxyManager {
  constructor() {
    this.proxies = this.loadProxies();
    this.currentIndex = 0;
  }

  loadProxies() {
    // Support multiple proxy types
    return [
      // SOCKS5 proxies (recommended)
      process.env.SOCKS5_PROXY_1,
      process.env.SOCKS5_PROXY_2,
      
      // HTTPS proxies
      process.env.HTTPS_PROXY_1,
      process.env.HTTPS_PROXY_2,
      
      // Residential proxies (for undetectability)
      process.env.RESIDENTIAL_PROXY_1
    ].filter(Boolean);
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;
    
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  createAgent(proxyUrl) {
    if (!proxyUrl) return null;
    
    if (proxyUrl.startsWith('socks5://')) {
      return new SocksProxyAgent(proxyUrl);
    } else if (proxyUrl.startsWith('https://')) {
      return new HttpsProxyAgent(proxyUrl);
    }
    return null;
  }
}

const proxyManager = new ProxyManager();

// Enhanced browser launcher with proxy support
async function launchBrowserWithProxy(proxyUrl = null) {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  };

  // Add proxy if provided
  if (proxyUrl) {
    launchOptions.args.push(`--proxy-server=${proxyUrl}`);
  }

  return await puppeteer.launch(launchOptions);
}

// Cache setup
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});
await redisClient.connect();

// Rate limiting
const requestCounts = new Map();
const RATE_LIMIT = 100; // requests per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const requests = requestCounts.get(ip).filter(time => time > windowStart);
  requests.push(now);
  requestCounts.set(ip, requests);
  
  return requests.length <= RATE_LIMIT;
}

// Main rendering endpoint
app.get('/render', async (req, res) => {
  const url = req.query.url;
  const userIP = req.ip;
  
  // Input validation
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Validate URL format
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Rate limiting
  if (!checkRateLimit(userIP)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  // Check cache first
  const cacheKey = `render:${url}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'text/html');
      res.set('X-Cache', 'HIT');
      return res.send(cached);
    }
  } catch (cacheError) {
    console.warn('Cache error:', cacheError);
  }

  let browser;
  try {
    // Get proxy for this request
    const proxyUrl = proxyManager.getNextProxy();
    const agent = proxyManager.createAgent(proxyUrl);
    
    // Launch browser with proxy
    browser = await launchBrowserWithProxy(proxyUrl);
    const page = await browser.newPage();

    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Enable request interception to handle resources
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      // Block unnecessary resources to improve speed
      const resourceType = request.resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for additional JavaScript execution
    await page.waitForTimeout(2000);

    // Get fully rendered HTML
    const htmlContent = await page.content();

    // Cache the result (5 minutes)
    await redisClient.setEx(cacheKey, 300, htmlContent);

    res.set('Content-Type', 'text/html');
    res.set('X-Cache', 'MISS');
    res.send(htmlContent);

  } catch (error) {
    console.error('Rendering error:', error);
    res.status(500).json({ 
      error: 'Failed to render website',
      details: error.message 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    proxyCount: proxyManager.proxies.length
  });
});

// Proxy status endpoint
app.get('/proxy-status', (req, res) => {
  res.json({
    totalProxies: proxyManager.proxies.length,
    currentRotationIndex: proxyManager.currentIndex,
    proxies: proxyManager.proxies.map((p, i) => ({
      index: i,
      type: p.startsWith('socks5') ? 'SOCKS5' : 'HTTPS',
      active: true
    }))
  });
});

app.listen(port, () => {
  console.log(`Enhanced website renderer running on port ${port}`);
});
