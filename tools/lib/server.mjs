import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.glb':'model/gltf-binary', '.png':'image/png', '.json':'application/json' };
export async function serve(root, port = 0) {
  const base = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (file !== base && !file.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }).end(data);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Asset unavailable');
    }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve,reject) => server.close(e => e ? reject(e) : resolve())) };
}
