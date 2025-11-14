if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/proxy.sw.js', { scope: '/' })
    .then(reg => console.log('Proxy SW registered'))
    .catch(err => console.error('Proxy SW registration failed', err));
}

// Proxy location wrapper (for JS functionality)
window.proxyLocationHref = window.location.href;
