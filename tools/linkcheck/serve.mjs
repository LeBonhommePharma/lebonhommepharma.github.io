/**
 * Minimal static server that mimics GitHub Pages resolution semantics, so a
 * locally-served build artifact behaves the way the deployed artifact does.
 *
 * Deliberately mirrors the parts of Pages that change pass/fail outcomes:
 *   - "/dir"        -> 301 to "/dir/"        (Pages does this)
 *   - "/dir/"       -> serves "/dir/index.html"
 *   - missing path  -> 404 (body from ./404.html when present)
 *   - path lookups are CASE-SENSITIVE even on macOS, because the Pages host is
 *     Linux. A case-only mismatch is a real 404 in production and must not be
 *     silently "fixed" by a case-insensitive local filesystem.
 *
 * Usage (standalone):  node tools/linkcheck/serve.mjs <dir> [port]
 */
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
};

/**
 * Case-sensitive existence check. On macOS the filesystem is case-insensitive
 * by default, so stat() would happily resolve "Assets/x.png" for "assets/x.png"
 * and hide a bug that is a hard 404 on the Linux Pages host.
 */
async function resolveCaseSensitive(root, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let cur = root;
  for (const part of parts) {
    let entries;
    try {
      entries = await readdir(cur);
    } catch {
      return null;
    }
    if (!entries.includes(part)) return null;
    cur = path.join(cur, part);
  }
  return cur;
}

export async function createServer(rootDir) {
  const root = path.resolve(rootDir);
  let notFoundBody = 'Not Found';
  try {
    notFoundBody = await readFile(path.join(root, '404.html'), 'utf8');
  } catch {
    /* no custom 404 page in the artifact; plain body is fine */
  }

  const server = http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }

    // Refuse traversal outright rather than normalising it away silently.
    if (pathname.includes('..')) {
      res.writeHead(400).end('Bad Request');
      return;
    }

    const send = async (status, filePath, extraHeaders = {}) => {
      if (!filePath) {
        res.writeHead(status, { 'content-type': MIME['.html'], ...extraHeaders });
        res.end(req.method === 'HEAD' ? undefined : notFoundBody);
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(status, {
        'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        ...extraHeaders,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    const rel = pathname.replace(/^\/+/, '');

    if (pathname.endsWith('/')) {
      const idx = await resolveCaseSensitive(root, rel + 'index.html');
      if (idx) return send(200, idx);
      return send(404, null);
    }

    const hit = await resolveCaseSensitive(root, rel);
    if (hit) {
      const st = await stat(hit);
      if (st.isDirectory()) {
        // Pages redirects a directory request to the trailing-slash form.
        res.writeHead(301, { location: pathname + '/' }).end();
        return;
      }
      return send(200, hit);
    }
    return send(404, null);
  });

  return server;
}

export async function listen(rootDir, port = 0) {
  const server = await createServer(rootDir);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address();
  return { server, port: actual, base: `http://127.0.0.1:${actual}/` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || '.';
  const port = Number(process.argv[3] || 8765);
  const { base } = await listen(dir, port);
  console.log(`serving ${path.resolve(dir)} at ${base}`);
}
