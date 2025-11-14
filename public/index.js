if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/proxy.sw.js', { scope: '/' })
    .then(reg => console.log('Proxy SW registered'))
    .catch(err => console.error('Proxy SW registration failed', err));
}

document.getElementById('urlForm').addEventListener('submit', function(event) {
  event.preventDefault();
  let url = document.getElementById('urlInput').value;
  if (!url.startsWith('http')) url = 'https://' + url;  // Auto-add https
  const encodedUrl = '/scramjet/' + Buffer.from(url).toString('base64');
  window.open(encodedUrl, '_blank');
});
