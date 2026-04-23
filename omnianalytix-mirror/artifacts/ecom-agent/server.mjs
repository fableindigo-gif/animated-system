import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'dist/public');

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.webp':  'image/webp',
  '.txt':   'text/plain',
  '.xml':   'application/xml',
};

const DOMAIN = 'omnianalytix.in';

const server = http.createServer((req, res) => {
  const host = (req.headers['x-forwarded-host'] || req.headers['host'] || '').split(':')[0];

  if (host && host.startsWith('www.')) {
    const url = req.url || '/';
    res.writeHead(301, {
      'Location': `https://${DOMAIN}${url}`,
      'Cache-Control': 'max-age=86400',
    });
    res.end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];
  let filePath = path.join(STATIC_DIR, urlPath);

  let stat = null;
  try { stat = fs.statSync(filePath); } catch (_) {}

  if (!stat || stat.isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  const isImmutable = urlPath.startsWith('/assets/');
  const cacheControl = isImmutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });
    res.end(content);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OmniAnalytix frontend serving on port ${PORT}`);
});
