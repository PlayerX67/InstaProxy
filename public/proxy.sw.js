importScripts('/proxy.config.js');  // Load config

addEventListener('install', event => {
  self.skipWaiting();
});

addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.startsWith(self.__proxy$config.prefix)) {
    event.respondWith(proxyRequest(req, url));
  } else {
    event.respondWith(fetch(req));
  }
});

async function proxyRequest(req, url) {
  const targetPath = url.pathname.slice(self.__proxy$config.prefix.length);
  let targetUrl = self.__proxy$config.decodeUrl(targetPath);

  // Handle relative paths in subrequests
  if (!targetUrl.startsWith('http')) {
    // Reconstruct from referrer (simplified; use req.referrer in prod)
    targetUrl = new URL(targetUrl, 'https://example.com').href;  // Placeholder; enhance with actual base
  }

  const originReq = new Request(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.blob() : null,
    redirect: 'manual'
  });

  const originRes = await fetch(originReq);

  let body = await originRes.blob();
  const contentType = originRes.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    const text = await body.text();
    body = new Blob([rewriteHtml(text)], { type: 'text/html' });
  } else if (contentType.includes('javascript')) {
    const text = await body.text();
    body = new Blob([rewriteJs(text)], { type: 'application/javascript' });
  } else if (contentType.includes('css')) {
    const text = await body.text();
    body = new Blob([rewriteCss(text)], { type: 'text/css' });
  }

  return new Response(body, {
    status: originRes.status,
    statusText: originRes.statusText,
    headers: originRes.headers
  });
}

// Rewriters (original, inspired by Scramjet snippets)
function rewriteHtml(html) {
  const prefix = self.__proxy$config.prefix;
  return html.replace(/(src|href)=["']([^"']+)["']/g, (match, attr, src) => {
    if (src.startsWith('http') || src.startsWith('//')) return match;
    const encoded = self.__proxy$config.encodeUrl(src);
    return `${attr}="${prefix}${encoded}"`;
  });
}

function rewriteJs(js) {
  // Basic JS rewrite (e.g., replace fetch URLs; expandable)
  return js.replace(/fetch\(['"]([^'"]+)['"]\)/g, (match, url) => {
    if (url.startsWith('http')) return match;
    return `fetch('${self.__proxy$config.prefix}${self.__proxy$config.encodeUrl(url)}')`;
  });
}

function rewriteCss(css) {
  const prefix = self.__proxy$config.prefix;
  return css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
    if (url.startsWith('http') || url.startsWith('//')) return match;
    const encoded = self.__proxy$config.encodeUrl(url);
    return `url(${prefix}${encoded})`;
  });
}
