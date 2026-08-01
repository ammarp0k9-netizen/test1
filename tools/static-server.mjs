import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2]) || 8765;
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }

  const appRoute = pathname === '/app' || pathname === '/app/' || pathname.startsWith('/app/');
  const relativePath = pathname === '/'
    ? 'landing.html'
    : appRoute
      ? 'index.html'
      : pathname === '/privacy' || pathname === '/privacy/'
        ? 'privacy.html'
        : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  const sendFile = (targetPath, fallbackAllowed) => fs.readFile(targetPath, (error, data) => {
    if (error?.code === 'ENOENT' && fallbackAllowed) {
      sendFile(path.join(root, 'index.html'), false);
      return;
    }
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code || 'Error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(targetPath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  });

  const extensionlessRoute = !path.extname(relativePath);
  sendFile(filePath, extensionlessRoute);
}).listen(port, '127.0.0.1', () => {
  console.log(`LootLingua audit server: http://127.0.0.1:${port}`);
});
