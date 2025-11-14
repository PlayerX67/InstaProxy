const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
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
app.use('/proxy', createProxyMiddleware({
  router: (req) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      throw new Error('No URL provided');
    }
    return targetUrl;
  },
  changeOrigin: true,
  followRedirects: true,
  pathRewrite: (path, req) => {
    // Remove the /proxy prefix from the path
    return '';
  },
  onProxyReq: (proxyReq, req, res) => {
    // Add CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Remove origin headers to avoid CORS issues
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
    
    console.log('Proxying request to:', req.query.url);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err.message);
    res.status(500).json({ 
      error: 'Proxy error', 
      message: err.message 
    });
  }
}));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
});
