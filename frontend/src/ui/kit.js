/* Reusable view pieces: page header, table, charts, cards, tabs, badges, links. */
/* ---- ui kits ---- */
function ph(title, sub, actions) {
  return `<div class="ph"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions || ''}</div></div>`;
}
function table(id, cols, rows, o) {
  o = o || {};
  const T = S.tbl[id] || (S.tbl[id] = { page: 1, sort: null, dir: 1 });
  let data = rows.slice();
  if (T.sort != null && cols[T.sort] && cols[T.sort].s) {
    const c = cols[T.sort];
    data.sort((a, b) => {
      const x = c.s(a),
        y = c.s(b);
      return (x > y ? 1 : x < y ? -1 : 0) * T.dir;
    });
  }
  const ps = o.ps || 10,
    pages = Math.max(1, Math.ceil(data.length / ps));
  if (T.page > pages) T.page = pages;
  const sl = o.all ? data : data.slice((T.page - 1) * ps, T.page * ps);
  const head = cols
    .map(
      (c, i) =>
        `<th class="${c.s ? 's' : ''}${c.r ? ' r' : ''}"${c.s ? ` data-act="tsort" data-t="${id}" data-c="${i}"` : ''}>${c.h}${T.sort === i ? (T.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`,
    )
    .join('');
  const body = sl
    .map(
      (r) =>
        `<tr${o.row ? ` class="cl" ${o.row(r)}` : ''}>${cols.map((c) => `<td class="${c.r ? 'r num' : ''} ${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${data.length ? '' : `<div class="empty"><b>${esc(o.et || 'Nothing to show')}</b>${esc(o.ed || 'No records match the current view.')}</div>`}${o.all || data.length <= ps ? `<div class="pager"><span>${data.length} record${data.length === 1 ? '' : 's'}</span></div>` : `<div class="pager"><span>${(T.page - 1) * ps + 1}–${Math.min(T.page * ps, data.length)} of ${data.length}</span><span class="row"><button class="btn sm" data-act="tpage" data-t="${id}" data-p="${T.page - 1}"${T.page <= 1 ? ' disabled' : ''}>Previous</button><span>Page ${T.page} / ${pages}</span><button class="btn sm" data-act="tpage" data-t="${id}" data-p="${T.page + 1}"${T.page >= pages ? ' disabled' : ''}>Next</button></span></div>`}`;
}
Object.assign(ACT, {
  tsort(d) {
    const T = S.tbl[d.t] || (S.tbl[d.t] = { page: 1, sort: null, dir: 1 }),
      c = +d.c;
    if (T.sort === c) T.dir = -T.dir;
    else {
      T.sort = c;
      T.dir = 1;
    }
    render();
  },
  tpage(d) {
    S.tbl[d.t].page = +d.p;
    render();
  },
});
const CATCOL = {
  Hot: 'var(--c6)',
  Warm: 'var(--c5)',
  Cold: 'var(--c1)',
  'Not Interested': 'var(--c3)',
  'No Response': 'var(--c4)',
};
function bars(items, o) {
  o = o || {};
  const mx = o.max || Math.max(1, ...items.map((i) => i.v));
  return `<div class="bars">${items.map((i) => `<div class="bar${i.go ? ' cl' : ''}" ${i.go || ''}><div class="lb" title="${esc(i.l)}">${esc(i.l)}</div><div class="tr"><i style="width:${Math.max(i.v ? 2 : 0, (i.v / mx) * 100)}%;${i.c ? `background:${i.c}` : ''}"></i></div><div class="vl">${o.fmt ? o.fmt(i.v) : i.v}</div></div>`).join('') || '<div class="empty">No data for this selection.</div>'}</div>`;
}
function donut(items, total) {
  const R = 42,
    C = 2 * Math.PI * R;
  let off = 0;
  const tot = total || items.reduce((a, b) => a + b.v, 0) || 1;
  const seg = items
    .filter((i) => i.v > 0)
    .map((i) => {
      const l = (i.v / tot) * C;
      const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${i.c}" stroke-width="16" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"${i.go ? ` ${i.go}` : ''} style="${i.go ? 'cursor:pointer' : ''}"><title>${esc(i.l)}: ${i.v}</title></circle>`;
      off += l;
      return s;
    })
    .join('');
  return `<div class="donutw"><svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label="Distribution"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line2)" stroke-width="16"/>${seg}<text x="60" y="58" text-anchor="middle" font-size="20" font-weight="600" fill="var(--fg)">${tot === 1 && !items.some((i) => i.v) ? 0 : tot}</text><text x="60" y="74" text-anchor="middle" font-size="9" fill="var(--muted)">total</text></svg><div class="legend" style="flex-direction:column;gap:6px">${items.map((i) => `<span${i.go ? ` ${i.go} style="cursor:pointer"` : ''}><i style="background:${i.c}"></i>${esc(i.l)} <b style="color:var(--fg)">${i.v}</b></span>`).join('')}</div></div>`;
}
function funnel(items) {
  const mx = Math.max(1, items[0].v);
  return `<div class="funnel">${items.map((i, k) => `<div class="fn" ${i.go || ''}><span class="n">${esc(i.l)}</span><div class="bx" style="width:${Math.max(8, (i.v / mx) * 100)}%;${i.c ? `background:${i.c}` : ''}">${i.v}</div>${k ? `<span class="muted xs">${Math.round((i.v / mx) * 100)}%</span>` : ''}</div>`).join('')}</div>`;
}
function dl(rows) {
  return `<dl class="kv">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${r[1] == null || r[1] === '' ? '<span class="faint">—</span>' : r[1]}</dd>`).join('')}</dl>`;
}
const emptyBox = (t, d) => `<div class="empty"><b>${esc(t)}</b>${esc(d || '')}</div>`;
const card = (title, body, o) => {
  o = o || {};
  return `<section class="card ${o.cls || ''}">${title ? `<div class="hd"><h3>${title}</h3><div class="row">${o.act || ''}</div></div>` : ''}<div class="bd${o.np ? ' np' : ''}">${body}</div></section>`;
};
const tabsBar = (items, cur, act, extra) =>
  `<div class="tabs" role="tablist">${items.map((t) => `<a role="tab" tabindex="0" class="${t[0] === cur ? 'on' : ''}" data-act="${act}" data-k="${t[0]}" ${extra || ''}>${esc(t[1])}</a>`).join('')}</div>`;
const slaB = (l) => {
  const s = sla(l);
  return s.s === '—' ? '<span class="faint">—</span>' : bdg(s.s + (s.late ? ' (late)' : ''), s.k);
};
const catB = (c) => bdg(c, catKind(c));
const stB = (s) =>
  bdg(
    s,
    {
      Open: 'info',
      Converted: 'ok',
      Lost: 'crit',
      Closed: '',
      Enrolled: 'ok',
      Lost: 'crit',
      Active: 'ok',
      Paid: 'ok',
      'Partially paid': 'warn',
      Unpaid: 'crit',
      Pending: 'warn',
      Approved: 'ok',
      Rejected: 'crit',
      'On Hold': 'warn',
      Inactive: '',
      Completed: 'ok',
      Withdrawn: 'crit',
      Success: 'ok',
      Failed: 'crit',
      'Retry Required': 'warn',
      Processing: 'info',
    }[s] || '',
  );
const lgo = (id) => `data-act="go" data-page="lead" data-id="${id}"`;
const sgo = (id) => `data-act="go" data-page="student" data-id="${id}"`;
const goA = (page, o) =>
  `data-act="go" data-page="${page}"${Object.keys(o || {})
    .map((k) => ` data-${k}="${esc(o[k])}"`)
    .join('')}`;
const leadLink = (l) => `<a ${lgo(l.id)}>${esc(l.student)}</a>`;
function simBanner() {
  return `<div class="banner">${ic('alert')}<span><b>Prototype.</b> All data is fictional. WhatsApp, Meta, telephony, payment gateway, ERPNext and LMS are <b>not connected</b>; related actions are simulated and labelled.</span></div>`;
}
