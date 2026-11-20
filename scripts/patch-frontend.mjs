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
  // Lab of Future style guide (Student Learning Hub look): Inter, the real logo in the sidebar, and
  // public/lof-theme.css loaded after the prototype's styles (the sign-in screens keep their own design)
  ['family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono', 'family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono'],
  ['<div class="logo">LOF</div><div><b>Lab of Future</b><small>CRM & Sales · Prototype</small></div>',
    '<img class="brand-logo" src="/lof-logo.png" alt="Lab of Future – CRM &amp; Sales" width="480" height="135"><span class="brand-mark" aria-hidden="true"></span>'],
  // Activities & Calls: a conversation log (context of any conversation – call, WhatsApp, visit, e-mail, meeting) above the call log (api-client.js → convCard)
  ["if (tab === 'activity') return card('Call log', table('lcalls', [", "if (tab === 'activity') return (window.convCard ? window.convCard(l) : '') + card('Call log', table('lcalls', ["],
  // light / dark switch in the top bar (as in the Hub): moon in light mode, sun in dark mode; the choice is remembered
  ['<button class="iconbtn" data-act="go" data-page="notifications"', '<button class="iconbtn theme-toggle" data-act="theme" title="Switch between light and dark theme" aria-label="Switch between light and dark theme"><svg class="ico i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg><svg class="ico i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>\n  <button class="iconbtn" data-act="go" data-page="notifications"'],
  ['  </style>\n  <div id="app"></div>', '  </style>\n  <link rel="stylesheet" href="/lof-theme.css">\n  <div id="app"></div>'],
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
  // Follow-ups a counsellor schedules (follow-up form, next call after a call log, parent-requested slot) go on
  // that counsellor's own calendar, also on leads owned by a colleague or not yet assigned. Other roles schedule
  // for the lead's counsellor as before. Automatic cadence tasks stay with the lead's counsellor.
  ['function syncNext(l) {', "function fuOwner(l) { const u = me(); return u && u.role === 'Counsellor' ? u.id : l.cslr }\n    function syncNext(l) {"],
  ["S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: l.cslr, due: locIso(d.next)", "S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: fuOwner(l), due: locIso(d.next)"],
  ["S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: l.cslr, due: l.avail.slot", "S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: fuOwner(l), due: l.avail.slot"],
  ["S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: l.cslr, due, type: d.type", "S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: fuOwner(l), due, type: d.type"],
  ["F('Assigned counsellor', 'cs', { v: l.cslr || '', opts: optCslr(l.branch), blank: 'Unassigned', dis: 1 })", "F('On the calendar of', 'cs', { v: fuOwner(l) || '', opts: optCslr(), blank: 'Unassigned', dis: 1 })"],
  // Calendar: managers can pick one counsellor's calendar (counsellors always see their own)
  ["const tasks = visTasks().filter(t => t.status !== 'Cancelled');", "const tasks = visTasks().filter(t => t.status !== 'Cancelled' && (!S.calCs || me().role === 'Counsellor' || t.cslr === S.calCs));"],
  ["'Scheduled calls, follow-ups and parent-requested slots', `<button class=\"btn sm\" data-act=\"calNav\" data-n=\"-1\">",
    "me().role === 'Counsellor' ? 'Your scheduled calls, follow-ups and parent-requested slots' : 'Scheduled calls, follow-ups and parent-requested slots', `${me().role === 'Counsellor' ? '' : `<select data-change=\"calCs\" aria-label=\"Counsellor\"><option value=\"\">All counsellors</option>${optCslr().map(([v, n]) => `<option value=\"${esc(v)}\"${S.calCs === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`}<button class=\"btn sm\" data-act=\"calNav\" data-n=\"-1\">"],
  // Payment Collection: tick the instalments being paid (2nd only, or 2nd + 3rd together); the amount follows the
  // ticks instead of always starting at the whole outstanding balance. Ticking a later instalment includes the
  // earlier unpaid ones (payments are applied to instalments in order). The amount can still be typed by hand.
  ['function schedTable(rows, cur) {', `function payOpen(e) { return instStatus(e).filter(r => r.bal > 0.005) }
    function payUpto(e) { const un = payOpen(e); if (!un.length) return 0; const s = S.payInst && S.payInst.enr === e.id ? S.payInst.upto : 0; return s >= un[0].n ? s : un[0].n }
    function paySum(e, upto) { return r2(payOpen(e).filter(r => r.n <= upto).reduce((a, r) => a + r.bal, 0)) }
    function payAmtDefault(e) { const un = payOpen(e); return un.length ? paySum(e, payUpto(e)) : r2(e.total - e.paid) }
    function payInstTable(e) {
      const rows = instStatus(e), un = rows.filter(r => r.bal > 0.005); if (rows.length < 2 || !un.length) return schedTable(rows, e.cur); const u = payUpto(e);
      return \`<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:56px">Pay</th><th>Instalment</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Balance</th><th>Status</th></tr></thead><tbody>\${rows.map(r => { const open = r.bal > 0.005; return \`<tr><td>\${open ? \`<input type="checkbox" data-change="payInst" data-n="\${r.n}" aria-label="Pay instalment \${r.n} of \${rows.length}"\${r.n <= u ? ' checked' : ''} style="width:18px;height:18px;cursor:pointer">\` : ''}</td><td>\${r.n} of \${rows.length} <span class="muted xs">(\${r.pct}%)</span></td><td>\${dayFmt(r.due)}</td><td class="r num">\${money(r.amt, e.cur)}</td><td class="r num">\${money(r.paid, e.cur)}</td><td class="r num">\${money(r.bal, e.cur)}</td><td>\${instB(r.st)}</td></tr>\` }).join('')}</tbody></table></div><div class="muted xs" style="margin-top:6px">Tick the instalments being paid – the amount below follows. Ticking a later instalment includes the unpaid ones before it.</div>\`
    }
    CHG.payInst = el => { const e = enrById(S.payPick); if (!e) return; const n = +el.dataset.n, upto = el.checked ? n : n - 1; S.payInst = { enr: e.id, upto }; document.querySelectorAll('[data-change="payInst"]').forEach(c => { c.checked = +c.dataset.n <= upto }); const a = document.querySelector('#payf [name=amt]'); if (a) { const v = paySum(e, upto); a.value = v > 0 ? v : ''; a.dispatchEvent(new Event('input', { bubbles: true })) } };
    function schedTable(rows, cur) {`],
  ['<div class="sec">Instalments</div>${schedTable(instStatus(pick), pick.cur)}<form id="payf"', '<div class="sec">Instalments</div>${payInstTable(pick)}<form id="payf"'],
  ["F('Amount (' + pick.cur + ')', 'amt', { t: 'number', min: 0.01, step: '0.01', v: out, req: 1 })", "F('Amount (' + pick.cur + ')', 'amt', { t: 'number', min: 0.01, step: '0.01', v: payAmtDefault(pick), req: 1, help: 'Follows the ticked instalments; outstanding in total ' + money(out, pick.cur) + '.' })"],
  // Communication remarks: one list of calls, WhatsApp and e-mails with a Remarks column (api-client.js → commTable)
  ["card('Communication history', table('lcomm', [", "card('Communication history', window.commTable ? window.commTable(l) : table('lcomm', ["],
  ["{ np: 1, act: edit ? `<button class=\"btn sm\" data-act=\"mWa\"", "{ np: 1, act: edit ? `<button class=\"btn sm\" data-act=\"mCall\" data-id=\"${l.id}\">Log call</button><button class=\"btn sm\" data-act=\"mWa\""],
  ["{ h: 'Recording', f: c => c.rec ? esc(c.rec) : '<span class=\"faint\">—</span>' }], calls,", "{ h: 'Recording', f: c => c.rec ? esc(c.rec) : '<span class=\"faint\">—</span>' }, { h: 'Remarks', f: c => window.remarkCell ? window.remarkCell('call', c) : '' }], calls,"],
  // Communications tab: the full list across the page, availability and consent cards below it
  ["if (tab === 'comms') { const av = l.avail; return `<div class=\"grid g2\"><div>", "if (tab === 'comms') { const av = l.avail; return `<div class=\"grid\"><div>"],
  ["</div><div class=\"grid\">${card('Parent call availability'", "</div><div class=\"grid g2\">${card('Parent call availability'"],
  // Payments → Payment links: also visible to counsellors (their own links); Records lists active payments, cancelled ones have their own section
  ["if (r === '*appr') return anyApprove();", "if (r === '*plinks') return !!(window.canSeeLinks && window.canSeeLinks()); if (r === '*appr') return anyApprove();"],
  ["const ps = S.pay.filter(p => inScope(p.branch)).sort((a, b) => new Date(b.at) - new Date(a.at)), f = S.payF", "const ps = S.pay.filter(p => p.status !== 'Cancelled' && inScope(p.branch)).sort((a, b) => new Date(b.at) - new Date(a.at)), f = S.payF"],
  // Branch GST: fees at a branch with CGST + SGST are charged at that rate (api-client.js → feeTaxPct)
  ["tax = r2(net * fee.tax / 100)", "tax = r2(net * (window.feeTaxPct ? window.feeTaxPct(fee) : fee.tax) / 100)"],
  // Student 360: edit personal information (api-client.js → MODALS.stuEdit) and each parent / guardian (MODALS.parentEdit)
  ["['Address', esc(s.address)]]))}${card('Enrolment information'", "['Address', esc(s.address)], ['Student e-mail', esc(s.email || '—')], ['Student mobile', esc(s.mobile || '—')]]), { act: E ? `<button class=\"btn sm\" data-act=\"mStuEdit\" data-id=\"${s.id}\">Edit</button>` : '' })}${card('Enrolment information'"],
  ["{ h: 'Profession', f: p => esc(p.job) }], s.parents, { all: 1 })", "{ h: 'Profession', f: p => esc(p.job) }, { h: '', f: p => E ? `<button class=\"btn sm\" data-act=\"mParentEdit\" data-id=\"${s.id}\" data-i=\"${s.parents.indexOf(p)}\">Edit</button>` : '' }], s.parents, { all: 1 })"],
  // Fee master: Course ID column (empty for older fees until it is filled in)
  ["{ h: 'Package', f: f => esc(f.pkg) }, { h: 'Sessions', f: f => f.sessions, r: 1 }", "{ h: 'Package', f: f => esc(f.pkg) }, { h: 'Course ID', f: f => f.courseId ? `<span class=\"mono\">${esc(f.courseId)}</span>` : '<span class=\"faint\">—</span>', s: f => f.courseId || '' }, { h: 'Sessions', f: f => f.sessions, r: 1 }"],
  // Fee master: Indian branches show the branch's CGST + SGST in the Tax column (api-client.js → feeTaxCell)
  ["{ h: 'Tax', f: f => f.tax + '%', r: 1 }", "{ h: 'Tax', f: f => window.feeTaxCell ? window.feeTaxCell(f) : f.tax + '%', r: 1 }"],
  ["<dt>Tax (${f.tax}%)</dt>", "<dt>${window.feeTaxLabel ? esc(window.feeTaxLabel(f)) : 'Tax (' + f.tax + '%)'}</dt>"],
  // Cancelled transactions keep their receipt numbers in every list but drop out of all totals
  ["S.pay.filter(p => p.branch === b[0] && dayKey(p.at)", "S.pay.filter(p => p.status !== 'Cancelled' && p.branch === b[0] && dayKey(p.at)"],
  ["S.pay.filter(p => p.branch === b.id && dayKey(p.at)", "S.pay.filter(p => p.status !== 'Cancelled' && p.branch === b.id && dayKey(p.at)"],
  ['const RP = () => S.pay.filter(p => inScope(p.branch)', "const RP = () => S.pay.filter(p => p.status !== 'Cancelled' && inScope(p.branch)"],
  ['const tot = x.reduce((a, p) => a + toAED(p.amt, p.cur), 0);', "const tot = x.filter(p => p.status !== 'Cancelled').reduce((a, p) => a + toAED(p.amt, p.cur), 0);"],
  ["{ h: 'Status', f: p => bdg(p.status, 'info') }], x, { ps: 12 })", "{ h: 'Status', f: p => bdg(p.status, p.status === 'Cancelled' ? 'crit' : 'info') + (p.cancel ? '<div class=\"muted xs\">' + esc(p.cancel.reason) + '</div>' : '') }, { h: '', f: p => window.payCancelBtn ? payCancelBtn(p) : '' }], x, { ps: 12 })"],
  ["{ h: 'Amount', f: p => money(p.amt, p.cur), r: 1 }, { h: 'Method', f: p => p.method }, { h: '', f: p => `<button class=\"btn sm\" data-act=\"receipt\"", "{ h: 'Amount', f: p => money(p.amt, p.cur) + (p.status === 'Cancelled' ? ' ' + bdg('Cancelled', 'crit') : ''), r: 1 }, { h: 'Method', f: p => p.method }, { h: '', f: p => `<button class=\"btn sm\" data-act=\"receipt\""],
  ["{ h: 'Amount', f: p => money(p.amt, p.cur), r: 1 }, { h: 'Method', f: p => p.method }, { h: 'Reference', f: p => esc(p.ref) }], S.pay.filter(p => p.stu === pick.stu)", "{ h: 'Amount', f: p => money(p.amt, p.cur) + (p.status === 'Cancelled' ? ' ' + bdg('Cancelled', 'crit') : ''), r: 1 }, { h: 'Method', f: p => p.method }, { h: 'Reference', f: p => esc(p.ref) }], S.pay.filter(p => p.stu === pick.stu)"],
  ["'Method', 'Reference', 'Receipt'], rows: ps.map(p => [p.id, fDT(p.at), stuById(p.stu).first + ' ' + stuById(p.stu).last, branchName(p.branch), p.enr, p.amt, p.cur, p.method, p.ref, p.rc])", "'Method', 'Reference', 'Receipt', 'Status', 'Cancellation reason'], rows: ps.map(p => [p.id, fDT(p.at), stuById(p.stu).first + ' ' + stuById(p.stu).last, branchName(p.branch), p.enr, p.amt, p.cur, p.method, p.ref, p.rc, p.status, p.cancel ? p.cancel.reason : ''])"],
  // Payment link from an opportunity: whoever may share it fills in the enrolment form (applied when the parent pays)
  ["wizard: ['enrollments', 'C']", "wizard: ['*wiz']"],
  ['function allowed(rt) { const a = ACCESS[rt.page]; if (!a) return true; ', "function allowed(rt) { const a = ACCESS[rt.page]; if (!a) return true; if (a[0] === '*wiz') return can('enrollments', 'C') || !!((S.wiz && S.wiz.viaLink) || S.pendingViaLink); "],
  ['CHG.callF = el => { S.callF = el.value; render() };','CHG.callF = el => { S.callF = el.value; render() };\n    CHG.calCs = el => { S.calCs = el.value; render() };'],
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
