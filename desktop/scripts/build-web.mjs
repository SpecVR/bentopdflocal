// Builds the BentoPDF web app with settings for the desktop wrapper and
// copies the output to desktop/app-dist.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const config = JSON.parse(fs.readFileSync(path.join(desktopDir, 'desktop.config.json'), 'utf8'));

const origin = `http://127.0.0.1:${config.port}`;
const wasm = `${origin}/wasm`;

const env = {
  ...process.env,
  HUSKY: '0',
  SIMPLE_MODE: 'true',
  COMPRESSION_MODE: 'o',
  DISABLE_GITHUB_STARS: 'true',
  VITE_WASM_PYMUPDF_URL: `${wasm}/pymupdf/`,
  VITE_WASM_GS_URL: `${wasm}/gs/`,
  VITE_WASM_CPDF_URL: `${wasm}/cpdf/`,
  VITE_TESSERACT_WORKER_URL: `${wasm}/ocr/worker.min.js`,
  VITE_TESSERACT_CORE_URL: `${wasm}/ocr/core`,
  VITE_TESSERACT_LANG_URL: `${wasm}/ocr/lang-data`,
  VITE_TESSERACT_AVAILABLE_LANGUAGES: config.ocrLanguages.join(','),
  VITE_OCR_FONT_BASE_URL: `${wasm}/ocr/fonts`,
  VITE_EMBEDPDF_FONTS_URL: `${wasm}/embedpdf-fonts`,
  // Served by the desktop app's own local server (see main.js).
  VITE_CORS_PROXY_URL: `${origin}/cors-proxy`,
};

// The upstream build script uses POSIX shell syntax, so on Windows run npm
// scripts through Git Bash.
function scriptShellArgs() {
  if (process.platform !== 'win32') return [];
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.error('Git Bash is required to build on Windows (install Git for Windows).');
    process.exit(1);
  }
  return [`--script-shell=${found}`];
}

function run(args) {
  console.log(`\n> npm ${args.join(' ')}`);
  const r = spawnSync('npm', args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(repoRoot, 'node_modules'))) {
  run(['ci', '--no-audit', '--no-fund', ...scriptShellArgs()]);
}
run(['run', 'build', ...scriptShellArgs()]);

const src = path.join(repoRoot, 'dist');
const dest = path.join(desktopDir, 'app-dist');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

fs.mkdirSync(path.join(desktopDir, 'build'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'public/images/favicon-512x512.png'),
  path.join(desktopDir, 'build/icon.png')
);

console.log(`\nWeb build copied to ${dest}`);
