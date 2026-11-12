/* Leads list, filters and bulk selection. */
/* ====== lead list ====== */
const LC = [
  ['id', 'Lead ID', (l) => `<span class="mono">${l.id}</span>`, (l) => l.id, 1],
  ['student', 'Prospect', (l) => `<b>${esc(l.student)}</b>`, (l) => l.student, 1],
  ['parent', 'Parent / guardian', (l) => esc(l.parent), (l) => l.parent, 1],
  ['phone', 'Mobile', (l) => `<span class="mono">${esc(l.phone)}</span>`, null, 1],
  ['email', 'Email', (l) => esc(l.email), null, 0],
  ['branch', 'Branch', (l) => esc(branchName(l.branch)), (l) => l.branch, 1],
  ['prog', 'Programme', (l) => esc(PNAME(l.prog)), (l) => l.prog, 1],
  ['src', 'Source', (l) => esc(l.src), (l) => l.src, 1],
  ['camp', 'Campaign', (l) => esc(l.camp), (l) => l.camp, 0],
  ['cat', 'Category', (l) => catB(l.cat), (l) => l.cat, 1],
  ['stage', 'Stage', (l) => esc(l.stage), (l) => LSTAGES.indexOf(l.stage), 1],
  [
    'cslr',
    'Counsellor',
    (l) => (l.cslr ? esc(staffName(l.cslr)) : bdg('Unassigned', 'warn')),
    (l) => staffName(l.cslr),
    1,
  ],
  ['enq', 'Enquiry', (l) => fDT(l.enq), (l) => l.enq, 1],
  ['sla', 'First-call SLA', (l) => slaB(l), (l) => sla(l).s, 1],
  [
    'fu',
    'Next follow-up',
    (l) =>
      l.nextFU
        ? `<span class="${new Date(l.nextFU) < NOW && l.status === 'Open' ? '' : ''}">${fDT(l.nextFU)}</span>${new Date(l.nextFU) < NOW && l.status === 'Open' ? ' ' + bdg('Overdue', 'crit') : ''}`
        : '<span class="faint">—</span>',
    (l) => l.nextFU || '',
    1,
  ],
  ['last', 'Last activity', (l) => rel(l.last), (l) => l.last, 0],
  ['status', 'Status', (l) => stB(l.status), (l) => l.status, 1],
];
function filteredLeads() {
  const F = S.lf,
    rt = S.route,
    p = rt.preset || 'all';
  let ls = leadScope();
  const u = me();
  if (p === 'mine') ls = ls.filter((l) => l.cslr === u.id);
  else if (p === 'unassigned') ls = ls.filter((l) => !l.cslr && l.status === 'Open');
  else if (['Hot', 'Warm', 'Cold'].includes(p)) ls = ls.filter((l) => l.cat === p && l.status === 'Open');
  else if (['Not Interested', 'No Response'].includes(p)) ls = ls.filter((l) => l.cat === p);
  const q = (F.q || '').toLowerCase();
  return ls.filter(
    (l) =>
      (!q || [l.id, l.student, l.parent, l.phone, l.email].some((x) => String(x).toLowerCase().includes(q))) &&
      (!F.branch || l.branch === F.branch) &&
      (!F.source || l.src === F.source) &&
      (!F.camp || l.camp === F.camp) &&
      (!F.cslr || (F.cslr === 'none' ? !l.cslr : l.cslr === F.cslr)) &&
      (!F.prog || l.prog === F.prog) &&
      (!F.category || l.cat === F.category) &&
      (!F.status || l.status === F.status) &&
      (!F.stage || l.stage === F.stage) &&
      (!F.from || dayKey(l.enq) >= F.from) &&
      (!F.to || dayKey(l.enq) <= F.to) &&
      (!F.sla ||
        (F.sla === 'risk' ? l.status === 'Open' && ['Breached', 'Due Soon'].includes(sla(l).s) : sla(l).s === F.sla)) &&
      (!F.fu || (l.status === 'Open' && (!l.fc || (l.nextFU && new Date(l.nextFU) < new Date(BASE + 864e5))))),
  );
}
const PRESET_T = {
  all: 'All Leads',
  mine: 'My Leads',
  unassigned: 'Unassigned Leads',
  Hot: 'Hot Leads',
  Warm: 'Warm Leads',
  Cold: 'Cold Leads',
  'Not Interested': 'Not Interested',
  'No Response': 'No Response',
};
let S_sel = {};
PAGES.leads = (rt) => {
  const F = S.lf,
    p = rt.preset || 'all',
    ls = filteredLeads(),
    sel = Object.keys(S_sel).filter((k) => ls.find((l) => l.id === k));
  const vis = LC.filter((c) => (S.cols[c[0]] == null ? c[4] : S.cols[c[0]]));
  const cols = [
    {
      h: `<input type="checkbox" data-change="selall" aria-label="Select all"${sel.length && sel.length === ls.length ? ' checked' : ''}>`,
      f: (l) =>
        `<input type="checkbox" data-change="selrow" value="${l.id}" aria-label="Select ${esc(l.student)}"${S_sel[l.id] ? ' checked' : ''}>`,
    },
  ].concat(vis.map((c) => ({ h: c[1], f: c[2], s: c[3] })));
  const sb = optBranches();
  const opt = (arr, k) =>
    arr
      .map((a) => {
        const v = Array.isArray(a) ? a[0] : a,
          l = Array.isArray(a) ? a[1] : a;
        return `<option value="${esc(v)}"${F[k] === v ? ' selected' : ''}>${esc(l)}</option>`;
      })
      .join('');
  const tbar = `<div class="tb"><input type="search" id="lq" data-input="lq" placeholder="Search name, ID, phone, e-mail" value="${esc(F.q || '')}" aria-label="Search leads"><select data-change="lview" aria-label="View">${[
    ['all', 'All leads'],
    ['mine', 'My leads'],
    ['unassigned', 'Unassigned'],
    ['Hot', 'Hot'],
    ['Warm', 'Warm'],
    ['Cold', 'Cold'],
    ['Not Interested', 'Not interested'],
    ['No Response', 'No response'],
  ]
    .map((a) => `<option value="${a[0]}"${p === a[0] ? ' selected' : ''}>${a[1]}</option>`)
    .join('')}</select>
   <select name="branch" data-change="lf" aria-label="Branch"><option value="">All branches</option>${opt(sb, 'branch')}</select><select name="source" data-change="lf" aria-label="Source"><option value="">All sources</option>${opt(SRC_LIST, 'source')}</select><select name="camp" data-change="lf" aria-label="Campaign"><option value="">All campaigns</option>${opt(
     S.cfg.camps.map((c) => c.n),
     'camp',
   )}</select>
   <select name="cslr" data-change="lf" aria-label="Counsellor"><option value="">All counsellors</option><option value="none"${F.cslr === 'none' ? ' selected' : ''}>Unassigned</option>${opt(optCslr(), 'cslr')}</select><select name="prog" data-change="lf" aria-label="Programme"><option value="">All programmes</option>${opt(optProgs(), 'prog')}</select>
   <select name="category" data-change="lf" aria-label="Category"><option value="">All categories</option>${opt(CATS, 'category')}</select><select name="status" data-change="lf" aria-label="Status"><option value="">All statuses</option>${opt(['Open', 'Converted', 'Lost', 'Closed'], 'status')}</select>
   <select name="sla" data-change="lf" aria-label="SLA"><option value="">Any SLA</option>${opt([['risk', 'At risk'], 'On Track', 'Due Soon', 'Breached', 'Completed'], 'sla')}</select>
   <label class="row sm muted">From <input type="date" name="from" value="${F.from || ''}" data-change="lf"></label><label class="row sm muted">To <input type="date" name="to" value="${F.to || ''}" data-change="lf"></label></div>
   <div class="tb"><select data-change="savedApply" aria-label="Saved filters"><option value="">Saved filters…</option>${S.saved.map((s, i) => `<option value="${i}">${esc(s.n)}</option>`).join('')}</select><button class="btn sm" data-act="saveFilter">Save current filter</button><button class="btn sm ghost" data-act="clearLf">Clear filters</button><span style="margin-left:auto" class="row"><button class="btn sm" data-act="colMenu">Columns</button></span></div>
   ${S.colOpen ? `<div class="tb" style="background:var(--panel2)">${LC.map((c) => `<label class="chk sm"><input type="checkbox" data-change="colToggle" value="${c[0]}"${(S.cols[c[0]] == null ? c[4] : S.cols[c[0]]) ? ' checked' : ''}> ${c[1]}</label>`).join('')}</div>` : ''}`;
  const bulk = sel.length
    ? `<div class="tb" style="background:var(--accent-soft)"><b>${sel.length} selected</b>${can('reassignment', 'E') ? `<button class="btn sm" data-act="bulkAssign">Assign to counsellor</button>` : ''}${can('leads', 'E') ? `<button class="btn sm" data-act="bulkCat">Change category</button>` : ''}<button class="btn sm ghost" data-act="selClear">Clear selection</button>${!can('reassignment', 'E') ? '<span class="muted xs">Assignment requires Centre Administrator, Admissions Head or System Administrator.</span>' : ''}</div>`
    : '';
  const view =
    S.lfView === 'table'
      ? `<div class="card">${tbar}${bulk}${table('leads', cols, ls, { ps: 10, row: (l) => lgo(l.id), et: 'No leads match', ed: p === 'unassigned' ? 'Every open lead has a counsellor.' : 'Clear a filter or create a new lead.' })}</div>`
      : kanbanLeads(ls, tbar);
  const caps = S.cfg.sources.filter((s) => s.en && ['Website', 'Facebook', 'Instagram', 'WhatsApp'].includes(s.n));
  return (
    ph(
      PRESET_T[p],
      ls.length + ' lead' + (ls.length === 1 ? '' : 's') + ' in view' + (p === 'mine' ? ' · assigned to you' : ''),
      `<span class="seg"><a class="${S.lfView === 'table' ? 'on' : ''}" data-act="lfView" data-v="table" tabindex="0">Table</a><a class="${S.lfView === 'kanban' ? 'on' : ''}" data-act="lfView" data-v="kanban" tabindex="0">Pipeline</a></span>${can('leads', 'C') ? `<button class="btn" data-act="openSimCapture">${ic('download')} Simulate web / Meta capture</button><button class="btn primary" data-act="openNewLead">${ic('plus')} New lead</button>` : ''}`,
    ) + view
  );
};
function kanbanLeads(ls, tbar) {
  const cols = ['New Lead', 'Contacted', 'Qualified', 'Opportunity', 'Closed / Lost'];
  const g = (c) =>
    ls.filter((l) =>
      c === 'Closed / Lost'
        ? ['Closed', 'Lost'].includes(l.status)
        : l.status === 'Converted'
          ? c === 'Opportunity'
          : ['Closed', 'Lost'].includes(l.status)
            ? false
            : l.stage === c,
    );
  return `<div class="card" style="margin-bottom:12px">${tbar}</div><div class="kb">${cols
    .map(
      (c) =>
        `<div class="kcol" data-drop="lkDrop" data-to="${c}"><h4><span>${c}</span><span>${g(c).length}</span></h4><div class="kl">${
          g(c)
            .map(
              (l) =>
                `<div class="kc" ${l.status === 'Open' && can('leads', 'E') ? `draggable="true" data-drag="${l.id}"` : ''} ${lgo(l.id)}><div class="n">${esc(l.student)}</div><div class="muted sm">${esc(l.parent)} · ${esc(PNAME(l.prog))}</div><div class="row" style="margin-top:6px">${catB(l.cat)}${slaB(l)}</div><div class="muted xs" style="margin-top:6px">${esc(branchName(l.branch))} · ${esc(staffName(l.cslr))}</div></div>`,
            )
            .join('') || '<div class="muted xs" style="padding:8px">Drop leads here</div>'
        }</div></div>`,
    )
    .join(
      '',
    )}</div><p class="muted xs">Drag open leads between columns. Moving to Opportunity opens the conversion form; moving to Closed / Lost asks for a mandatory reason.</p>`;
}
Object.assign(ACT, {
  lfView(d) {
    S.lfView = d.v;
    render();
  },
  colMenu() {
    S.colOpen = !S.colOpen;
    render();
  },
  selClear() {
    S_sel = {};
    render();
  },
  clearLf() {
    S.lf = {};
    render();
  },
  saveFilter() {
    const f = Object.assign({}, S.lf);
    if (!Object.keys(f).length) {
      toast('Set at least one filter before saving', 'warn');
      return;
    }
    S.saved.push({ n: 'Saved filter ' + (S.saved.length + 1), f });
    toast('Filter saved – find it under “Saved filters”', 'ok');
    render();
  },
  lkDrop(d) {
    const l = leadById(d.id);
    if (!l) return;
    if (!can('leads', 'E') || l.status !== 'Open') {
      toast('Only open leads can be moved by users with edit access', 'warn');
      return;
    }
    if (d.to === 'Closed / Lost') return openModal('lostLead', { id: l.id });
    if (d.to === 'Opportunity') {
      if (l.stage !== 'Qualified') {
        toast('Lead must be Qualified before it becomes an Opportunity', 'warn');
        return;
      }
      return openModal('convert', { id: l.id });
    }
    if (l.stage === d.to) return;
    l.stage = d.to;
    addEv(l, 'sys', 'Stage changed to ' + d.to + ' (pipeline)');
    addAudit('Lead stage changed', l.id, '→ ' + d.to);
    render();
    toast('Stage updated to ' + d.to, 'ok');
  },
});
CHG.lf = (el) => {
  S.lf[el.name] = el.value;
  if (!el.value) delete S.lf[el.name];
  S.tbl.leads && (S.tbl.leads.page = 1);
  render();
};
INP.lq = (el) => {
  S.lf.q = el.value;
  if (!el.value) delete S.lf.q;
  S.tbl.leads && (S.tbl.leads.page = 1);
  render();
};
CHG.savedApply = (el) => {
  if (el.value === '') return;
  S.lf = Object.assign({}, S.saved[+el.value].f);
  render();
  toast('Applied saved filter', 'ok');
};
CHG.colToggle = (el) => {
  const c = LC.find((x) => x[0] === el.value);
  S.cols[el.value] = el.checked;
  render();
};
CHG.selrow = (el) => {
  if (el.checked) S_sel[el.value] = 1;
  else delete S_sel[el.value];
  render();
};
CHG.selall = (el) => {
  const ls = filteredLeads();
  ls.forEach((l) => {
    if (el.checked) S_sel[l.id] = 1;
    else delete S_sel[l.id];
  });
  render();
};
