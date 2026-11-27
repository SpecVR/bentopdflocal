// Version follows the upstream BentoPDF version in the repo root.
const rootPkg = require('../package.json');

module.exports = {
  appId: 'com.bentopdf.desktop',
  productName: 'BentoPDF',
  copyright: 'BentoPDF contributors, AGPL-3.0',
  extraMetadata: { version: rootPkg.version },
  directories: { output: 'release', buildResources: 'build' },
  // The web app is shipped unpacked next to the asar so the local server can
  // stream it straight from disk.
  files: ['main.js', 'desktop.config.json', 'build/icon.png', 'package.json'],
  extraResources: [{ from: 'app-dist', to: 'app-dist' }],
  asar: true,
  compression: 'normal',
  artifactName: '${productName}-${version}-${arch}.${ext}',

  win: {
    icon: 'build/icon.png',
    target: ['portable', 'zip'],
    // Requires Wine when building Windows targets from Linux; CI builds on Windows.
    signAndEditExecutable: process.platform === 'win32',
  },
  portable: {
    artifactName: '${productName}-${version}-portable.exe',
    // Unpack once into a stable folder instead of a fresh temp dir every launch.
    unpackDirName: 'BentoPDF-portable',
  },

  linux: {
    icon: 'build/icon.png',
    category: 'Office',
    target: ['AppImage', 'deb', 'rpm'],
    maintainer: 'BentoPDF Desktop <noreply@example.com>',
    synopsis: 'Privacy-first offline PDF toolkit',
    syncDesktopName: true,
  },
  deb: { packageName: 'bentopdf-desktop' },
  rpm: { packageName: 'bentopdf-desktop' },
};
