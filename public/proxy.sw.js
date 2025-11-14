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
  } else if (url.pathname === self.__proxy$config.sw) {
    event.respondWith(self.registration.scope);
  } else {
    event.respondWith(fetch(req));
  }
});

async function proxyRequest(req, url) {
  const targetPath = url.pathname.slice(self.__proxy$config.prefix.length);
  const targetUrl = self.__proxy$config.decodeUrl(targetPath);

  // Fetch the original content
  const originReq = new Request(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.blob() : null,
    redirect: 'manual'
  });

  const originRes = await fetch(originReq);

  // Rewrite response (inspired by Scramjet rewriter snippets)
  const contentType = originRes.headers.get('content-type') || '';
  let body = await originRes.blob();

  if (contentType.includes('text/html')) {
    body = await rewriteHtml(await body.text());
  } else if (contentType.includes('javascript')) {
    body = rewriteJs(await body.text());
  } else if (contentType.includes('css')) {
    body = rewriteCss(await body.text());
  }

  return new Response(body, {
    status: originRes.status,
    statusText: originRes.statusText,
    headers: originRes.headers
  });
}

// Simple rewriters (original, inspired by Scramjet/UV rewriting logic)
function rewriteHtml(html) {
  return html.replace(/src="([^"]*)"/g, (match, src) => `src="${self.__proxy$config.prefix}${self.__proxy$config.encodeUrl(src)}"`)
             .replace(/href="([^"]*)"/g, (match, href) => `href="${self.__proxy$config.prefix}${self.__proxy$config.encodeUrl(href)}"`);
}

function rewriteJs(js) {
  // Basic URL rewrite in JS
  return js.replace(/location.href/g, 'proxyLocationHref');
  // Add more sophisticated rewriting as needed
}

function rewriteCss(css) {
  return css.replace(/url\(([^)]*)\)/g, (match, url) => `url(${self.__proxy$config.prefix}${self.__proxy$config.encodeUrl(url)})`);
}
