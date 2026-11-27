# BentoPDF Desktop

An offline desktop build of [BentoPDF](https://github.com/alam00000/bentopdf), the privacy-first PDF toolkit, for Windows and Linux.

It has every PDF tool from the web version, packaged as a normal desktop app:

| Platform | Download                         | Notes                                                    |
| -------- | -------------------------------- | -------------------------------------------------------- |
| Windows  | `BentoPDF-<version>-portable.exe` | Single file, no installer, no admin rights needed        |
| Windows  | `BentoPDF-<version>-x64.zip`      | Same app as a plain folder; unzip and run `BentoPDF.exe` |
| Linux    | `BentoPDF-<version>-x86_64.AppImage` | Runs on most distributions, no install needed        |
| Linux    | `BentoPDF-<version>-amd64.deb`    | Debian, Ubuntu, Mint, Pop!_OS                            |
| Linux    | `BentoPDF-<version>-x86_64.rpm`   | Fedora, RHEL, openSUSE                                   |

Downloads are on the [Releases](../../releases) page of this repository.

## Why a desktop build?

- **Fully offline.** The PDF engines (PyMuPDF, Ghostscript, CoherentPDF, LibreOffice), the OCR engine and its language data, and the fonts are all bundled. Nothing is downloaded at runtime and no file ever leaves your computer.
- **No Docker, no web server to set up, no Node.js needed to run it.** Download and open.
- **Portable on Windows.** The `.exe` runs from anywhere, including a USB stick, and keeps its settings in a `BentoPDF-data` folder next to itself.

## Installing and running

### Windows

1. Download `BentoPDF-<version>-portable.exe`.
2. Double-click it.

The build is not code-signed, so the first time you run it Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

The first launch takes a little longer while the portable `.exe` unpacks itself to a temporary folder; later launches reuse that folder.

If you prefer to avoid the unpack step, use the `.zip` instead: extract it anywhere and run `BentoPDF.exe` inside.

### Linux

**AppImage**

```bash
chmod +x BentoPDF-*-x86_64.AppImage
./BentoPDF-*-x86_64.AppImage
```

Some distributions need FUSE 2 for AppImages (`sudo apt install libfuse2` on Ubuntu 22.04+).

**Debian / Ubuntu**

```bash
sudo apt install ./BentoPDF-*-amd64.deb
```

**Fedora / RHEL / openSUSE**

```bash
sudo dnf install ./BentoPDF-*-x86_64.rpm
```

After installing a `.deb` or `.rpm`, BentoPDF appears in your application menu under Office.

## Using it

Open the app and pick a tool, exactly as on the website. Files are added with the tool's own file picker or by dragging them onto the window. When a tool finishes, a normal save dialog asks where to put the result.

A few notes:

- **Office conversions (Word, Excel, PowerPoint to PDF)** use a WebAssembly build of LibreOffice. The first conversion in each session takes noticeably longer while the converter loads (it is roughly 250 MB in memory); after that, conversions are quick.
- **OCR** ships with English only by default. See [Adding OCR languages](#adding-ocr-languages) to bundle more.
- **Digital signatures:** fetching issuer certificates normally needs a separate proxy service. The desktop app handles this itself, so the Digital Signature tool works without any setup. This is the only feature that contacts the internet, and only to download certificates referenced by the certificate you sign with.
- **Opening PDFs from your file manager** ("Open with BentoPDF") is not supported yet; open files from inside the app.

## How it works

BentoPDF is a fully client-side web app: every tool runs inside the browser engine using JavaScript and WebAssembly. The desktop app is a thin [Electron](https://www.electronjs.org/) shell around it:

1. At build time, the web app is built in BentoPDF's "simple mode" (tools only, no marketing pages), with every external asset URL pointed at the app's own local address.
2. The WebAssembly modules, OCR data and fonts that the website normally loads from the jsDelivr CDN are downloaded once and bundled into the app.
3. At runtime, `main.js` starts a small web server bound to `127.0.0.1` (only reachable from your own computer) that serves those files with the same security headers as BentoPDF's official nginx config. The cross-origin isolation headers are what allow the LibreOffice converter to use `SharedArrayBuffer` and multiple threads.
4. A window opens on that local address. Links to outside websites open in your normal browser instead of inside the app.

The local server uses port **47823**. If another program is already using it, BentoPDF shows an error on startup; change `port` in `desktop/desktop.config.json` and rebuild.

## Building it yourself

### The easy way: GitHub Actions

This repository includes `.github/workflows/desktop-release.yml`, which builds every format on GitHub's own machines.

- **To build without publishing:** open the **Actions** tab, choose **Desktop builds**, and click **Run workflow**. When it finishes, the files are attached to the run as artifacts named `windows` and `linux`.
- **To publish a release:** push a tag that starts with `desktop-v`:

  ```bash
  git tag desktop-v2.8.12
  git push origin desktop-v2.8.12
  ```

  The workflow builds everything and creates a GitHub Release with all five files attached.

The workflow builds the web app once on Linux, then packages the Windows files on a Windows machine and the Linux files on a Linux machine.

### Building locally

Requirements:

- [Node.js](https://nodejs.org/) 22 or newer
- [Git](https://git-scm.com/)
- **On Windows:** Git for Windows, which provides the Git Bash shell. The upstream BentoPDF build script uses Unix shell syntax, and the build script runs it through Git Bash automatically.
- **For `.rpm` on Linux:** the `rpm` package (`sudo apt install rpm`).
- About 3 GB of free disk space and 4 GB of RAM for the build.

```bash
git clone https://github.com/<your-username>/bentopdf.git
cd bentopdf/desktop

npm ci                 # install Electron and the packaging tools
npm run prepare-app    # build the web app and download offline assets (10-20 min)
npm start              # optional: try it before packaging

npm run dist:win       # on Windows: portable .exe and .zip in desktop/release/
npm run dist:linux     # on Linux: .AppImage, .deb and .rpm in desktop/release/
```

`npm run prepare-app` is two steps you can also run separately:

- `npm run web` builds the BentoPDF web app with the desktop settings and copies it to `desktop/app-dist/`.
- `npm run assets` downloads the PDF engines, OCR data and fonts into `desktop/app-dist/wasm/`.

Windows packages should be built on Windows, and Linux packages on Linux. (Building the Windows `.exe` from Linux is possible but needs Wine to embed the icon.)

## Configuration

### Adding OCR languages

Edit `desktop/desktop.config.json` and list the [Tesseract language codes](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) you want:

```json
{
  "port": 47823,
  "ocrLanguages": ["eng", "deu", "fra", "spa"],
  "tessdataVersion": "4.0.0_best_int"
}
```

Then rebuild (`npm run prepare-app` and package again). Each language adds roughly 2 to 15 MB. Only bundled languages appear in the OCR tool.

### Branding, default language and disabled tools

The desktop build accepts the same build-time options as BentoPDF itself. Set them as environment variables before `npm run web`, for example:

```bash
VITE_BRAND_NAME="AcmePDF" VITE_DEFAULT_LANGUAGE=de DISABLE_TOOLS="sign-pdf,edit-pdf" npm run web
```

See the main [BentoPDF README](../README.md) for the full list. To set them in GitHub Actions, add them under `env:` in the "Build web app" step of the workflow.

The app's own name, icon and ID are set in `desktop/electron-builder.config.cjs` and `desktop/package.json`. The icon is taken from `public/images/favicon-512x512.png`; replace that file (or edit `scripts/build-web.mjs`) to use your own.

## Keeping up to date with BentoPDF

All desktop-specific files live in `desktop/` and `.github/workflows/desktop-release.yml`; nothing else in the BentoPDF source is changed. To pull in a new upstream version:

```bash
git remote add upstream https://github.com/alam00000/bentopdf.git   # once
git fetch upstream
git merge upstream/main
git push
```

Then build again. The app version shown in file names is taken from BentoPDF's own `package.json`, and the versions of the bundled engines are read from the BentoPDF source, so they follow upstream automatically.

## Project layout

```
desktop/
├── main.js                     Electron main process and local server
├── desktop.config.json         Port and OCR languages
├── electron-builder.config.cjs Packaging targets and metadata
├── package.json                Scripts and pinned tool versions
└── scripts/
    ├── build-web.mjs           Builds the web app for the desktop
    └── fetch-assets.mjs        Downloads WASM, OCR data and fonts
.github/workflows/
└── desktop-release.yml         CI builds and releases
```

Generated folders (`node_modules/`, `app-dist/`, `build/`, `release/`) are ignored by git.

## Troubleshooting

**"Port 47823 is already in use"**: another program, or a stuck BentoPDF process, is using the port. Close it, or change the port in `desktop.config.json` and rebuild.

**Windows: nothing happens when starting the `.exe`**: check whether antivirus software is quarantining it. Unsigned portable executables sometimes get flagged; the `.zip` build is a good alternative.

**Linux AppImage won't start**: install FUSE 2 (`libfuse2`), or run it with `--appimage-extract-and-run`.

**An Office conversion seems stuck**: the first conversion in a session loads the LibreOffice engine and can take a minute or more on slower machines. Leave it running.

**Build fails on Windows with a shell error**: install Git for Windows; the build needs its Git Bash.

## License

BentoPDF is licensed under the [GNU AGPL-3.0](../LICENSE), and so is this desktop build. The bundled PyMuPDF, Ghostscript and CoherentPDF engines are also AGPL-3.0.

In practice: you can use, share and modify this app freely, but if you distribute it (or a modified version), you must make the complete source code available under the same license. Keeping this repository public satisfies that. Building a closed-source product on top of BentoPDF requires BentoPDF's [commercial license](https://bentopdf.com/licensing.html).

This is an unofficial community build and is not affiliated with or supported by the BentoPDF team. Please report desktop-specific problems here rather than upstream.
