// Tiny local static server bound to 127.0.0.1. Usage: node scripts/serve.mjs [port]
// Malformed URLs get 400, paths outside the app or to hidden/test files get 404; errors never crash the server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown' };

export function resolvePath(url) {
  let p;
  try { p = decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return { status: 400 }; }
  if (p.includes('\0')) return { status: 400 };
  const rel = normalize(p === '/' ? '/index.html' : p);
  const file = join(root, rel);
  if (!file.startsWith(root + sep) || /(^|[\\/])(\.|node_modules|test|evidence)/.test(file.slice(root.length))) return { status: 404 };
  return { status: 200, file };
}

export function startServer(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      const r = resolvePath(req.url);
      if (r.status !== 200) { res.writeHead(r.status, { 'Content-Type': 'text/plain' }); return res.end(r.status === 400 ? 'Bad request' : 'Not found'); }
      const b = await readFile(r.file);
      res.writeHead(200, { 'Content-Type': (types[extname(r.file)] || 'application/octet-stream') + '; charset=utf-8' }); res.end(b);
    } catch { if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

// Run as a CLI only when this file is the entry point. Compare canonical real paths so a
// symlinked path (or macOS /var -> /private/var) still starts the server.
function canonical(p) { try { return realpathSync(p); } catch { return resolve(p); } }
export function isMainModule(argv1 = process.argv[1], selfUrl = import.meta.url) {
  if (!argv1) return false;
  return canonical(argv1) === canonical(fileURLToPath(selfUrl));
}

if (isMainModule()) {
  const port = Number(process.argv[2] || 8080);
  startServer(port).then(() => console.log(`DemoBudget at http://127.0.0.1:${port}/`));
}
