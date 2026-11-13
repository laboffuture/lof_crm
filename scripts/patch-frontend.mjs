// Builds public/index.html from the approved prototype: same screens, wired to the API by public/api-client.js.
// Open with ?demo=1 to run the original offline prototype (seed data in the browser, nothing saved).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
// LF only: browsers hash inline scripts with CRLF normalised to LF, so a Windows checkout (CRLF) would
// otherwise produce CSP hashes that block the screens
let html = readFileSync(new URL('prototype/LOF_CRM_Prototype.html', root), 'utf8').replace(/\r\n/g, '\n');

const patches = [
  // live clock instead of the prototype's frozen "now"
  [
    /const\s+TZ\s*=\s*'Asia\/Dubai'\s*,\s*BASE\s*=\s*Date\.parse\('2026-10-09T00:00:00\+04:00'\)\s*,\s*NOW\s*=\s*new\s+Date\('2026-10-09T13:53:00\+04:00'\);/,
    "const TZ='Asia/Dubai';let NOW=window.LOF_API?new Date():new Date('2026-10-09T13:53:00+04:00');let BASE=window.LOF_API?Date.parse(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dubai'})+'T00:00:00+04:00'):Date.parse('2026-10-09T00:00:00+04:00');",
  ],
  [/const\s+TODAY\s*=\s*dayKey\(NOW\.toISOString\(\)\);/, 'let TODAY=dayKey(NOW.toISOString());'],
  [/const\s+nowIso\s*=\s*\(\)\s*=>\s*NOW\.toISOString\(\);/, 'const nowIso=()=>(window.LOF_API?new Date():NOW).toISOString();'],
  [/\n\s*boot\(\);\s*\n\s*<\/script>/, '\nif(!window.LOF_API)boot();\n</script>\n<script src="/vendor/qrcode-generator-1.4.4.js"></script>\n<script src="/api-client.js"></script>'],
  ['<title>LOF CRM Prototype</title>', '<title>Lab of Future CRM</title>\n  <link rel="icon" type="image/png" href="/logo.png">'],
  ['<small>CRM & Sales · Prototype</small>', '<small>CRM & Sales</small>'],
  // long modal forms: let the body scroll so the footer buttons stay on screen
  [/\.hide\s*\{\s*display:\s*none\s*!important\s*\}/, '.hide{display:none!important}\n.modal{max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px)}.modal>form{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}.modal .mb{min-height:0;flex:1 1 auto}'],
  // Communication history: e-mail subject above the text, and Reply on received e-mails (api-client.js → mailReplyBtn)
  ["{ h: 'Message', f: c => esc(c.text) }, { h: 'Delivery', f: c => bdg(c.status, c.status.startsWith('Blocked') ? 'crit' : 'info') }], comms, { all: 1 })",
    "{ h: 'Message', f: c => ((c.subj || c.subject) ? '<b class=\"sm\">' + esc(c.subj || c.subject) + '</b><div>' + esc(c.text) + '</div>' : esc(c.text)) + (window.mailReplyBtn ? window.mailReplyBtn('lead', l.id, c) : '') }, { h: 'Delivery', f: c => bdg(c.status, c.status.startsWith('Blocked') ? 'crit' : c.inbound ? 'ok' : 'info') }], comms, { all: 1 })"],
  ["{ h: 'Message', f: c => esc(c.text) }, { h: 'Status', f: c => bdg(c.status, 'info') }], s.comm, { all: 1, et: 'No messages recorded' })",
    "{ h: 'Message', f: c => (c.subject ? '<b class=\"sm\">' + esc(c.subject) + '</b><div>' + esc(c.text) + '</div>' : esc(c.text)) + (window.mailReplyBtn ? window.mailReplyBtn('student', s.id, c, s.comm.indexOf(c)) : '') }, { h: 'Status', f: c => bdg(c.status, c.inbound ? 'ok' : 'info') }], s.comm, { all: 1, et: 'No messages recorded' })"],
  // No first-call SLA for Manual leads (created by staff while the family is at the lab): no First call task, no SLA badge/breach
  ["if (l.cslr) S.tasks.push({ id: 'T-' + (S.seq.task++), lead: id, cslr: l.cslr, due: new Date(NOW.getTime() + R.sla.mins", "if (l.cslr && l.src !== 'Manual') S.tasks.push({ id: 'T-' + (S.seq.task++), lead: id, cslr: l.cslr, due: new Date(NOW.getTime() + R.sla.mins"],
  [/function sla\(l\) \{/, "function sla(l) {\n      if (l.src === 'Manual') return { s: 'Not required', k: '' };"],
  // KPI cards stretch across the full width instead of leaving empty slots at the end of the row
  // (all 7 fit on one row on a laptop), and in a two-column chart grid an odd last card spans the full width
  ['grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));','grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));'],
  [/\.g3\s*\{/, '@media (max-width:1579px){.g2>:last-child:nth-child(odd){grid-column:1/-1}}\n' +
    // tighter spacing, and charts fill their cards (cards in a row share the tallest one's height)
    '    .content{padding:14px 16px 24px}.ph,.banner{margin-bottom:10px}.grid{gap:10px}.kpis{gap:10px;margin-bottom:10px}\n' +
    '    .grid>.card{display:flex;flex-direction:column}.grid>.card>.bd{flex:1 1 auto}\n' +
    '    .funnel,.bars{height:100%;justify-content:space-around}\n' +
    '    .donutw{height:100%;justify-content:center;gap:32px}.donutw>svg{width:min(180px,45%);height:auto}.donutw .legend{font-size:13px;gap:9px!important}\n' +
    '    .g3 {'],
  ['const filters = `<div class="card" style="margin-bottom:14px">', 'const filters = `<div class="card" style="margin-bottom:10px">'],
  // after sign-out the app state is cleared (S=null); global handlers must not touch it
  [/document\.addEventListener\('click',\s*e\s*=>\s*\{\s*if\s*\(S\.menu/, "document.addEventListener('click',e=>{if(!S)return;if(S.menu"],
  [/if\s*\(e\.key\s*===\s*'Escape'\s*&&\s*S\.modal\s*&&/, "if(e.key==='Escape'&&S&&S.modal&&"],
  [/if\s*\(a\)\s*\{\s*setTimeout\(\(\)\s*=>\s*\{\s*S\.modal\s*=\s*null;\s*render\(\)\s*\}\s*,\s*0\)\s*\}/, "if(a){setTimeout(()=>{if(S){S.modal=null;render()}},0)}"],
  // api-client.js (branch access control) replaces these scope helpers; a const cannot be reassigned
  // ("Assignment to constant variable" stops api-client.js and leaves the page blank)
  ['const inScope = b =>', 'let inScope = b =>'],
  ['const optBranches = () =>', 'let optBranches = () =>'],
  // demo staff IDs that may not exist in a real database (they crashed the top bar)
  [".map(i => S.staff.find(s => s.id === i));", ".map(i => S.staff.find(s => s.id === i)).filter(Boolean);"],
  ['S.staff.find(s => s.id === a.by).role', '(S.staff.find(s => s.id === a.by) || {}).role'],
  // prototype wording that no longer applies
  ['Email and WhatsApp delivery are simulated. Escalation', 'Email and WhatsApp are delivered when those integrations are live (Settings → Testing console). Escalation'],
  [
    /<script>\s*\n\s*'use strict';/,
    "<script>window.LOF_API=/[?&]demo=1/.test(location.search)?null:{base:'/api/v1'};</script>\n<script>\n'use strict';",
  ],
];

for (const [from, to] of patches) {
  const matched = typeof from === 'string' ? html.includes(from) : from.test(html);
  if (!matched) throw new Error('Prototype patch point not found: ' + String(from).slice(0, 80));
  html = html.replace(from, to);
}
writeFileSync(new URL('public/index.html', root), html);
console.log('public/index.html written (' + html.length + ' bytes)');

// Content-Security-Policy for the static app: inline scripts are allowed only by their exact hash,
// so injected markup can never run script. Inline styles are allowed (the screens use style attributes).
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
const csp = [
  "default-src 'self'",
  `script-src 'self' ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
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
writeFileSync(new URL('public/_headers', root), [
  '# GENERATED by scripts/patch-frontend.mjs – security headers for the static CRM screens',
  '/*', ...common, `  Content-Security-Policy: ${csp}`, '  X-Frame-Options: DENY', '  Cross-Origin-Opener-Policy: same-origin',
  '/', '  Cache-Control: no-cache',
  '/index.html', '  Cache-Control: no-cache',
  '/api-client.js', '  Cache-Control: no-cache',
  '/embed/*', '  Access-Control-Allow-Origin: *', '  Cache-Control: public, max-age=3600',
  '',
].join('\n'));
console.log('public/_headers written (' + hashes.length + ' inline script hashes)');
