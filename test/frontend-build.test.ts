// The screens are built from frontend/ (many small files) into public/. These tests keep that build honest.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const run = (script: string, ...args: string[]) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });

describe('frontend build', () => {
  it('every source file is listed, valid on its own, and declares no name twice', () => {
    expect(run('scripts/check-frontend.mjs')).toMatch(/frontend ok: \d+ files/);
  });

  it('produces external, content-hashed files and a page with no inline script', () => {
    run('scripts/build-frontend.mjs');
    const html = readFileSync('public/index.html', 'utf8');
    expect(html).not.toMatch(/<script>(?!<\/script>)/); // no inline code
    const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs).toHaveLength(3);
    for (const r of refs) {
      expect(r).toMatch(/^\/assets\/(app|api)\.[0-9a-f]{10}\.(js|css)$/);
      expect(existsSync('public' + r)).toBe(true);
      expect(existsSync('public' + r + '.map')).toBe(true);
    }
    expect(html.indexOf('/assets/app.')).toBeLessThan(html.indexOf('/vendor/qrcode')); // load order
    expect(html.indexOf('/vendor/qrcode')).toBeLessThan(html.indexOf('/assets/api.'));
  });

  it('source maps point to the individual source files', () => {
    const maps = readdirSync('public/assets').filter((f) => f.endsWith('.js.map'));
    const sources = maps.flatMap((f) => JSON.parse(readFileSync('public/assets/' + f, 'utf8')).sources as string[]);
    expect(sources).toContain('../../frontend/src/pages/leads/lead-list.js');
    expect(sources).toContain('../../frontend/src/api/sync.js');
  });

  it('keeps shared top-level names after minifying (other scripts call them)', () => {
    const app = readdirSync('public/assets').find((f) => /^app\..*\.js$/.test(f))!;
    const code = readFileSync('public/assets/' + app, 'utf8');
    for (const n of ['function render(', 'function go(', 'function boot(', 'function seed(', 'const PAGES=', 'const MODALS=']) expect(code).toContain(n);
  });

  it('allows scripts only from the site itself (no inline-script hashes needed)', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toMatch(/script-src 'self';/);
    expect(headers).not.toMatch(/sha256-/);
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });

  it('builds a self-contained offline demo page', () => {
    const page = readFileSync('dist/lof-crm-demo.html', 'utf8');
    expect(page).toContain('window.LOF_API=null');
    expect(page).not.toMatch(/<script src=|<link rel="stylesheet" href="\/assets/);
  });
});
