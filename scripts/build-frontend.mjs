// Builds the CRM screens from frontend/ into public/ (served by the Worker's static assets).
//
//   node scripts/build-frontend.mjs          → public/index.html + public/assets/app.<hash>.{css,js}, api.<hash>.js
//                                              and dist/lof-crm-demo.html (one self-contained offline demo page)
//   node scripts/build-frontend.mjs --watch  → rebuild on every change under frontend/
//
// frontend/manifest.json lists the source files in load order:
//   styles – concatenated into app.css
//   app    – the screens and workflow logic, concatenated into one strict-mode script (they share one scope)
//   api    – the server adapter, concatenated inside one closure that runs only when connected to the server
// Output is minified with esbuild and has source maps that point back to the individual source files, so
// browser dev tools show frontend/src/pages/leads/lead-list.js etc. No inline scripts are emitted, so the
// Content-Security-Policy allows scripts only from this site ('self').
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FE = join(ROOT, 'frontend');
const PUB = join(ROOT, 'public');
const ASSETS = join(PUB, 'assets');
const VENDOR = ['vendor/qrcode-generator-1.4.4.js'];

export function readManifest() {
  const m = JSON.parse(readFileSync(join(FE, 'manifest.json'), 'utf8'));
  for (const k of ['styles', 'app', 'api']) if (!Array.isArray(m[k]) || !m[k].length) throw new Error(`manifest.json: "${k}" missing`);
  return m;
}
const src = (rel) => readFileSync(join(FE, rel), 'utf8');

// ---------------------------------------------------------------- concatenation with a line-accurate source map
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const vlq = (n) => { let v = n < 0 ? (-n << 1) | 1 : n << 1, s = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B64[d]; } while (v); return s; };
/** Joins files; every output line maps to (file, line) so a later minify can carry the map through. */
function concat(parts /* [{ name, code } | { text }] */, css = false) {
  const out = [], sources = [], contents = [], maps = [];
  let prevSrc = 0, prevLine = 0;
  for (const p of parts) {
    const lines = (p.code ?? p.text).replace(/\n$/, '').split('\n');
    if (p.text != null) { for (const l of lines) { out.push(l); maps.push(''); } continue; }
    const si = sources.push('../../frontend/' + p.name) - 1; contents.push(p.code);
    lines.forEach((l, i) => {
      out.push(l);
      maps.push('A' + vlq(si - prevSrc) + vlq(i - prevLine) + 'A'); prevSrc = si; prevLine = i;
    });
  }
  const map = { version: 3, sources, sourcesContent: contents, names: [], mappings: maps.join(';') };
  const url = 'data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');
  return out.join('\n') + (css ? `\n/*# sourceMappingURL=${url} */\n` : `\n//# sourceMappingURL=${url}\n`);
}

async function minify(code, outName) {
  const tmp = join(ASSETS, '.tmp-' + outName);
  writeFileSync(tmp, code);
  try {
    // No bundling and no output format: the files stay classic scripts, so top-level names that other
    // scripts use (render, go, S, PAGES …) are kept; only local names are shortened.
    const r = await esbuild.build({ entryPoints: [tmp], write: false, minify: true, sourcemap: 'external', outfile: join(ASSETS, outName), legalComments: 'none', logLevel: 'silent', target: 'es2020' });
    const file = r.outputFiles.find((f) => !f.path.endsWith('.map')), map = r.outputFiles.find((f) => f.path.endsWith('.map'));
    return { code: file.text, map: map.text };
  } finally { rmSync(tmp, { force: true }); }
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

export async function build({ demo = true, quiet = false } = {}) {
  const m = readManifest();
  rmSync(ASSETS, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });

  const cssSrc = concat(m.styles.map((f) => ({ name: 'styles/' + f, code: src('styles/' + f) })), true);
  const appSrc = concat([{ text: "'use strict';" }, ...m.app.map((f) => ({ name: 'src/' + f, code: src('src/' + f) }))]);
  const apiSrc = concat([{ text: "(function () {\n'use strict';\nif (!window.LOF_API) return;" }, ...m.api.map((f) => ({ name: 'src/' + f, code: src('src/' + f) })), { text: '})();' }]);

  const files = {};
  for (const [kind, code, ext] of [['app', cssSrc, 'css'], ['app', appSrc, 'js'], ['api', apiSrc, 'js']]) {
    const r = await minify(code, `${kind}.${ext}`);
    const name = `${kind}.${hash(r.code)}.${ext}`;
    const comment = ext === 'css' ? `\n/*# sourceMappingURL=${name}.map */\n` : `\n//# sourceMappingURL=${name}.map\n`;
    const body = r.code.replace(/\n?(\/\/# sourceMappingURL=.*|\/\*# sourceMappingURL=.*\*\/)\s*$/, '') + comment;
    writeFileSync(join(ASSETS, name), body);
    writeFileSync(join(ASSETS, name + '.map'), r.map);
    files[`${kind}.${ext}`] = '/assets/' + name;
  }

  const shell = src('index.html');
  const html = shell
    .replace('<!-- build:css -->', () => `<link rel="stylesheet" href="${files['app.css']}">`)
    .replace('<!-- build:js -->', () => [files['app.js'], ...VENDOR.map((v) => '/' + v), files['api.js']].map((s) => `<script src="${s}"></script>`).join('\n'));
  if (html.includes('<!-- build:')) throw new Error('frontend/index.html: build marker not replaced');
  writeFileSync(join(PUB, 'index.html'), html);
  writeHeaders();

  if (demo) {
    // Single self-contained page for sharing a try-out (no server): demo mode forced, styles and scripts inline
    const appDemo = concat([{ text: "'use strict';" }, ...m.app.map((f) => ({ name: 'src/' + f, code: f === 'config.js' ? 'window.LOF_API = null;' : src('src/' + f) }))]);
    const js = (await minify(appDemo, 'demo.js')).code.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '');
    const css = (await minify(cssSrc, 'demo.css')).code.replace(/\n?\/\*# sourceMappingURL=.*\*\/\s*$/, '');
    const page = shell.replace('<title>Lab of Future CRM</title>', '<title>LOF CRM Demo</title>')
      // replacement functions, so "$" sequences in the code are not read as replace() patterns
      .replace('<!-- build:css -->', () => `<style>${css}</style>`)
      .replace('<!-- build:js -->', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
    mkdirSync(join(ROOT, 'dist'), { recursive: true });
    writeFileSync(join(ROOT, 'dist/lof-crm-demo.html'), page);
    if (!quiet) console.log('dist/lof-crm-demo.html written (' + Math.round(page.length / 1024) + ' KB)');
  }
  if (!quiet) console.log('public/index.html + ' + readdirSync(ASSETS).filter((f) => !f.endsWith('.map')).join(', '));
  return files;
}

// Content-Security-Policy for the static app: scripts only from this site; inline styles allowed
// (the screens use style attributes); fonts from Google Fonts.
function writeHeaders() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const common = [
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
  ];
  writeFileSync(join(PUB, '_headers'), [
    '# GENERATED by scripts/build-frontend.mjs – security headers for the static CRM screens',
    '/*', ...common, `  Content-Security-Policy: ${csp}`, '  X-Frame-Options: DENY', '  Cross-Origin-Opener-Policy: same-origin',
    '/', '  Cache-Control: no-cache',
    '/index.html', '  Cache-Control: no-cache',
    // file names change whenever the content does, so browsers may keep them for a year
    '/assets/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/embed/*', '  Access-Control-Allow-Origin: *', '  Cache-Control: public, max-age=3600',
    '',
  ].join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build();
  if (process.argv.includes('--watch')) {
    let t = null;
    console.log('watching frontend/ …');
    watch(FE, { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(() => build({ quiet: true }).then(() => console.log('rebuilt ' + new Date().toLocaleTimeString()), (e) => console.error(e.message)), 150);
    });
  }
}
