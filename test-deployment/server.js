const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = __dirname;
const CUSTOMER_DIR = path.join(PUBLIC_DIR, 'customer-workspace');
const WEB_DIR = path.join(PUBLIC_DIR, 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain'
};

function resolvePath(urlPath) {
  const cleanUrl = urlPath.split('?')[0].split('#')[0];

  // 1. API Pass-through (handled by proxy or health mock)
  if (cleanUrl.startsWith('/api/')) {
    return { type: 'api', path: cleanUrl };
  }

  // 2. Admin CSS isolation: /css/admin.css -> web/css/style.css
  if (cleanUrl === '/css/admin.css') {
    return { type: 'file', filePath: path.join(WEB_DIR, 'css', 'style.css') };
  }

  // 3. Admin JS isolation: /js/admin.js, /js/api.js, /js/firebase-config.js, /js/migration.js
  const adminJsMatch = cleanUrl.match(/^\/js\/(admin|api|firebase-config|migration)\.js$/);
  if (adminJsMatch) {
    return { type: 'file', filePath: path.join(WEB_DIR, 'js', `${adminJsMatch[1]}.js`) };
  }

  // 4. Customer CSS: /css/style.css -> customer-workspace/css/style.css
  if (cleanUrl === '/css/style.css') {
    return { type: 'file', filePath: path.join(CUSTOMER_DIR, 'css', 'style.css') };
  }

  // 5. Customer JS: /js/*.js -> customer-workspace/js/*.js
  if (cleanUrl.startsWith('/js/')) {
    const fileName = cleanUrl.replace(/^\/js\//, '');
    return { type: 'file', filePath: path.join(CUSTOMER_DIR, 'js', fileName) };
  }

  // 6. Customer media assets: /assets/* -> customer-workspace/assets/*
  if (cleanUrl.startsWith('/assets/')) {
    const assetPath = cleanUrl.replace(/^\/assets\//, '');
    return { type: 'file', filePath: path.join(CUSTOMER_DIR, 'assets', assetPath) };
  }

  // 7. Admin Workspace Route: /admin or /admin.html -> web/admin.html
  if (cleanUrl === '/admin' || cleanUrl === '/admin.html') {
    return { type: 'file', filePath: path.join(WEB_DIR, 'admin.html') };
  }

  // 8. Root Homepage: / or /index.html -> customer-workspace/index.html
  if (cleanUrl === '/' || cleanUrl === '/index.html') {
    return { type: 'file', filePath: path.join(CUSTOMER_DIR, 'index.html') };
  }

  // 9. Customer HTML pages: /shop, /categories, /custom-stickers, etc.
  const pageMatch = cleanUrl.match(/^\/([a-zA-Z0-9_-]+)(\.html)?$/);
  if (pageMatch) {
    const pageName = pageMatch[1];
    const customerPage = path.join(CUSTOMER_DIR, `${pageName}.html`);
    if (fs.existsSync(customerPage)) {
      return { type: 'file', filePath: customerPage };
    }
  }

  // 10. Fallback direct file lookup in customer-workspace or web
  const directCustomer = path.join(CUSTOMER_DIR, cleanUrl);
  if (fs.existsSync(directCustomer) && fs.statSync(directCustomer).isFile()) {
    return { type: 'file', filePath: directCustomer };
  }

  const directWeb = path.join(WEB_DIR, cleanUrl);
  if (fs.existsSync(directWeb) && fs.statSync(directWeb).isFile()) {
    return { type: 'file', filePath: directWeb };
  }

  return { type: '404' };
}

const server = http.createServer((req, res) => {
  const resolved = resolvePath(req.url);

  if (resolved.type === 'api') {
    if (req.url.startsWith('/api/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', environment: 'production-test-deployment' }));
      return;
    }
    // Proxy to live API
    const proxyOptions = {
      hostname: 'api.chipakk.shop',
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'api.chipakk.shop' }
    };
    const proxyReq = https.request(proxyOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    });
    req.pipe(proxyReq);
    return;
  }

  if (resolved.type === 'file') {
    const ext = path.extname(resolved.filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(resolved.filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.message}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 Not Found</h1><p>The requested URL was not found on this local deployment server.</p>');
});

if (require.main === module) {
  const isTestMode = process.argv.includes('--test');

  server.listen(PORT, async () => {
    console.log(`[Hostinger Local Test Server] Listening at http://localhost:${PORT}`);

    if (isTestMode) {
      console.log('Running automated verification suite...');
      let passed = 0;
      let failed = 0;

      const testCases = [
        { name: 'Root Customer Homepage (/)', url: '/', expectedStatus: 200, checkBody: 'CHIPAKK' },
        { name: 'Admin Workspace (/admin.html)', url: '/admin.html', expectedStatus: 200, checkBody: 'Admin Workspace' },
        { name: 'Customer CSS (/css/style.css)', url: '/css/style.css', expectedStatus: 200, contentType: 'text/css' },
        { name: 'Admin CSS (/css/admin.css)', url: '/css/admin.css', expectedStatus: 200, contentType: 'text/css' },
        { name: 'Customer Core JS (/js/app.js)', url: '/js/app.js', expectedStatus: 200, contentType: 'application/javascript' },
        { name: 'Customer Auth JS (/js/auth.js)', url: '/js/auth.js', expectedStatus: 200, contentType: 'application/javascript' },
        { name: 'Admin Core JS (/js/admin.js)', url: '/js/admin.js', expectedStatus: 200, contentType: 'application/javascript' },
        { name: 'Admin API JS (/js/api.js)', url: '/js/api.js', expectedStatus: 200, contentType: 'application/javascript' },
        { name: 'Customer Media Asset (/assets/images/logo.png)', url: '/assets/images/logo.png', expectedStatus: 200, contentType: 'image/png' },
        { name: 'API Health Proxy Check (/api/health)', url: '/api/health', expectedStatus: 200, checkBody: 'status' }
      ];

      for (const tc of testCases) {
        try {
          const resData = await new Promise((resolve, reject) => {
            http.get(`http://localhost:${PORT}${tc.url}`, (res) => {
              let body = '';
              res.on('data', chunk => body += chunk);
              res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
            }).on('error', reject);
          });

          let statusOk = resData.statusCode === tc.expectedStatus;
          let bodyOk = tc.checkBody ? resData.body.includes(tc.checkBody) : true;
          let typeOk = tc.contentType ? resData.headers['content-type']?.includes(tc.contentType) : true;

          if (statusOk && bodyOk && typeOk) {
            console.log(`  ✓ PASS: ${tc.name}`);
            passed++;
          } else {
            console.error(`  ✗ FAIL: ${tc.name} (Status: ${resData.statusCode}, Type: ${resData.headers['content-type']})`);
            failed++;
          }
        } catch (err) {
          console.error(`  ✗ ERROR: ${tc.name} - ${err.message}`);
          failed++;
        }
      }

      console.log(`\nVerification Complete: ${passed} passed, ${failed} failed.`);
      server.close(() => {
        process.exit(failed > 0 ? 1 : 0);
      });
    }
  });
}

module.exports = server;
