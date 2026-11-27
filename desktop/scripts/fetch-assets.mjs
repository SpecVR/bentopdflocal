// Downloads the WASM modules, OCR data and OCR fonts that the web build would
// otherwise load from jsDelivr, and places them in desktop/app-dist/wasm so the
// desktop app works fully offline. Everything comes from the npm registry and
// GitHub, mirroring what scripts/prepare-airgap.sh does.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const config = JSON.parse(fs.readFileSync(path.join(desktopDir, 'desktop.config.json'), 'utf8'));
const appDist = path.join(desktopDir, 'app-dist');
const wasmDir = path.join(appDist, 'wasm');

if (!fs.existsSync(appDist)) {
  console.error('desktop/app-dist is missing. Run "npm run web" first.');
  process.exit(1);
}

const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const match = (text, re, what) => {
  const m = text.match(re);
  if (!m) throw new Error(`Could not determine ${what}`);
  return m[1];
};

const cdnVersions = read('src/js/const/cdn-version.ts');
const lock = JSON.parse(read('package-lock.json'));
const versions = {
  pymupdf: match(cdnVersions, /pymupdf:\s*'([^']+)'/, 'PyMuPDF version'),
  gs: match(cdnVersions, /ghostscript:\s*'([^']+)'/, 'Ghostscript version'),
  cpdf: match(read('src/js/utils/wasm-provider.ts'), /coherentpdf@([\d.]+)/, 'CoherentPDF version'),
  tesseract: lock.packages['node_modules/tesseract.js'].version,
  tesseractCore: lock.packages['node_modules/tesseract.js-core'].version,
};
console.log('Asset versions:', versions);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bentopdf-assets-'));

// npm pack a package into tmp and extract it; returns the extracted "package" dir.
async function fetchPackage(spec) {
  console.log(`Downloading ${spec}...`);
  const out = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', tmp], {
    cwd: tmp,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const tgz = path.join(tmp, out.trim().split(/\r?\n/).pop());
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  await tar.x({ file: tgz, cwd: dir });
  return path.join(dir, 'package');
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

const pick = (base, sub) => (fs.existsSync(path.join(base, sub)) ? path.join(base, sub) : base);

fs.rmSync(wasmDir, { recursive: true, force: true });

copyDir(await fetchPackage(`@bentopdf/pymupdf-wasm@${versions.pymupdf}`), path.join(wasmDir, 'pymupdf'));
copyDir(pick(await fetchPackage(`@bentopdf/gs-wasm@${versions.gs}`), 'assets'), path.join(wasmDir, 'gs'));
copyDir(pick(await fetchPackage(`coherentpdf@${versions.cpdf}`), 'dist'), path.join(wasmDir, 'cpdf'));

const tess = await fetchPackage(`tesseract.js@${versions.tesseract}`);
fs.mkdirSync(path.join(wasmDir, 'ocr'), { recursive: true });
fs.copyFileSync(path.join(tess, 'dist/worker.min.js'), path.join(wasmDir, 'ocr/worker.min.js'));
copyDir(await fetchPackage(`tesseract.js-core@${versions.tesseractCore}`), path.join(wasmDir, 'ocr/core'));

const langDir = path.join(wasmDir, 'ocr/lang-data');
fs.mkdirSync(langDir, { recursive: true });
for (const lang of config.ocrLanguages) {
  const pkg = await fetchPackage(`@tesseract.js-data/${lang}`);
  const file = path.join(pkg, config.tessdataVersion, `${lang}.traineddata.gz`);
  if (!fs.existsSync(file)) throw new Error(`No ${config.tessdataVersion} data for OCR language "${lang}"`);
  fs.copyFileSync(file, path.join(langDir, `${lang}.traineddata.gz`));
}

// OCR text-layer fonts: same selection logic as prepare-airgap.sh.
const fontSource = read('src/js/config/font-mappings.ts');
const [langSection, fontSection = ''] = fontSource.split('export const fontFamilyToUrl');
const langToFamily = Object.fromEntries([...langSection.matchAll(/^\s*([a-z_]+):\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]));
const familyToUrl = Object.fromEntries([...fontSection.matchAll(/^\s*'([^']+)':\s*\n?\s*'([^']+)',/gm)].map((m) => [m[1], m[2]]));
const families = new Set(['Noto Sans', ...config.ocrLanguages.map((l) => langToFamily[l] || 'Noto Sans')]);

const fontDir = path.join(wasmDir, 'ocr/fonts');
fs.mkdirSync(fontDir, { recursive: true });
for (const family of families) {
  const url = familyToUrl[family] || familyToUrl['Noto Sans'];
  if (!url) throw new Error(`No font URL for ${family}`);
  // githack is a mirror of raw.githubusercontent.com; fetch from GitHub directly.
  const direct = url.replace('https://rawcdn.githack.com/', 'https://raw.githubusercontent.com/');
  console.log(`Downloading font ${family}...`);
  const res = await fetch(direct);
  if (!res.ok) throw new Error(`Font download failed (${res.status}): ${direct}`);
  fs.writeFileSync(path.join(fontDir, url.split('/').pop()), Buffer.from(await res.arrayBuffer()));
}

// PDF editor fallback fonts (CJK, Arabic, Hebrew, Latin) used when editing text.
const editorFonts = read('src/js/config/editor-fonts.ts');
const editorDir = path.join(wasmDir, 'embedpdf-fonts');
for (const [, pkgAtVer, file] of editorFonts.matchAll(/'(fonts-[a-z]+@[\d.]+)\/fonts\/([^']+)'/g)) {
  const pkg = await fetchPackage(`@embedpdf/${pkgAtVer}`);
  const to = path.join(editorDir, pkgAtVer, 'fonts');
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(pkg, 'fonts', file), path.join(to, file));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nOffline assets written to ${wasmDir}`);
