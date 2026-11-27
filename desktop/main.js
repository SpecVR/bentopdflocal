// BentoPDF desktop shell.
//
// Serves the built web app from a small HTTP server bound to 127.0.0.1 (a
// secure context, so SharedArrayBuffer and WASM threads work) with the same
// cross-origin isolation headers the upstream nginx config sends, then opens it
// in a window. Nothing is uploaded anywhere; the server only listens locally.
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, 'desktop.config.json'), 'utf8'));
const PORT = config.port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-dist')
  : path.join(here, 'app-dist');

// Portable .exe: keep settings next to the executable instead of %APPDATA%.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'BentoPDF-data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    app.setPath('userData', dataDir);
  } catch {
    // Read-only location: fall back to the default userData path.
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
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
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.data': 'application/octet-stream',
  '.gz': 'application/gzip',
};

// Reuse the CSP the build generated (dist/_headers), so the desktop app runs
// under the same policy as a self-hosted deployment.
function loadCsp() {
  try {
    const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
    const m = headers.match(/^\/\*\s*\n(?:[ \t]+.*\n)*?[ \t]+Content-Security-Policy:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const CSP = loadCsp();

function baseHeaders() {
  const h = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-cache',
  };
  if (CSP) h['Content-Security-Policy'] = CSP;
  return h;
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// nginx equivalent: try_files $uri $uri.html $uri/index.html =404
function resolveFile(urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const abs = path.join(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null; // traversal
  for (const candidate of [abs, `${abs}.html`, path.join(abs, 'index.html')]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function sendFile(req, res, file, status = 200) {
  const headers = baseHeaders();
  const name = path.basename(file);
  // LibreOffice ships pre-gzipped; the browser must decompress it transparently.
  if (/^soffice\.(wasm|data)\.gz$/.test(name)) {
    headers['Content-Type'] = name.startsWith('soffice.wasm') ? 'application/wasm' : 'application/octet-stream';
    headers['Content-Encoding'] = 'gzip';
  } else {
    headers['Content-Type'] = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  }
  headers['Content-Length'] = fs.statSync(file).size;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Local replacement for the Cloudflare CORS proxy used by the Digital Signature
// tool to fetch issuer certificates. Only certificate-like public URLs allowed.
const CERT_URL = /(\.(crt|cer|pem|der|p7c|crl)$)|\/certs?\/|\/ocsp|\/crl/i;
const PRIVATE_HOST = /^(localhost|.*\.local|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd]|\[?fe80)/i;
const MAX_PROXY_BYTES = 10 * 1024 * 1024;

async function corsProxy(reqUrl, res) {
  const fail = (code, msg) => {
    res.writeHead(code, { ...baseHeaders(), 'Content-Type': 'text/plain' });
    res.end(msg);
  };
  let target;
  try {
    target = new URL(reqUrl.searchParams.get('url') || '');
  } catch {
    return fail(400, 'Bad url');
  }
  if (!/^https?:$/.test(target.protocol) || PRIVATE_HOST.test(target.hostname)) {
    return fail(403, 'Host not allowed');
  }
  if (!CERT_URL.test(target.pathname)) return fail(403, 'Only certificate URLs are allowed');
  try {
    const upstream = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_PROXY_BYTES) return fail(413, 'Too large');
    res.writeHead(upstream.status, {
      ...baseHeaders(),
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    fail(502, `Fetch failed: ${err.message}`);
  }
}

function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  if (url.pathname === '/cors-proxy') return void corsProxy(url, res);

  // Mirror the upstream redirects that matter for in-app navigation.
  let p = url.pathname;
  if (/^\/en(\/|$)/.test(p)) p = p.replace(/^\/en/, '') || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  if (p !== url.pathname) {
    res.writeHead(301, { Location: p + url.search });
    return res.end();
  }

  const file = resolveFile(p);
  if (file) return sendFile(req, res, file);
  const notFound = path.join(ROOT, '404.html');
  if (isFile(notFound)) return sendFile(req, res, notFound, 404);
  res.writeHead(404);
  res.end('Not found');
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

let mainWindow = null;

function isAppUrl(u) {
  try {
    return new URL(u).origin === ORIGIN;
  } catch {
    return false;
  }
}

function configureWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath() },
      };
    }
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    }
  });
}

function iconPath() {
  const p = path.join(here, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'BentoPDF',
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(`${ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_e, contents) => configureWebContents(contents));

  app.whenReady().then(async () => {
    // No camera/mic/location etc. Clipboard and fullscreen only.
    const allowed = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));

    if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
      dialog.showErrorBox('BentoPDF', `App files not found in ${ROOT}.\nRun "npm run prepare-app" first.`);
      app.quit();
      return;
    }
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox(
        'BentoPDF',
        err.code === 'EADDRINUSE'
          ? `Port ${PORT} is already in use by another program.\nClose it or change "port" in desktop.config.json and rebuild.`
          : `Could not start the local server: ${err.message}`
      );
      app.quit();
      return;
    }
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
