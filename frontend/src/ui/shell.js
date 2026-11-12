/* Sidebar groups, access map, render(), modal frame and confirm dialog. */
/* ====== navigation ====== */
const anyApprove = () => can('discount_requests', 'V') || can('branch_transfers', 'V') || can('reassignment', 'V');
/* Simplified navigation: one sidebar entry per area; related screens are tabs on that area. Everything is gated by the permission matrix. */
const GROUPS = [
  { id: 'dash', label: 'Dashboard', icon: 'dash', tabs: [['dashboard', 'Dashboard', 'dash', null]] },
  {
    id: 'leads',
    label: 'Leads',
    icon: 'list',
    tabs: [
      ['leads', 'Leads', 'list', 'leads'],
      ['tasks', 'Follow-ups', 'check', 'leads'],
      ['calendar', 'Calendar', 'cal', 'leads'],
      ['calls', 'Call logs', 'phone', 'leads'],
      ['slaBreaches', 'SLA breaches', 'alert', 'leads'],
    ],
  },
  {
    id: 'opps',
    label: 'Opportunities',
    icon: 'kanban',
    tabs: [
      ['opps', 'Pipeline', 'kanban', 'opportunities'],
      ['lostOpps', 'Lost', 'x', 'opportunities'],
    ],
  },
  {
    id: 'adm',
    label: 'Admissions',
    icon: 'cap',
    tabs: [
      ['admPipeline', 'Pipeline', 'kanban', 'opportunities'],
      ['admDecisions', 'Decisions', 'check', 'opportunities'],
      ['enrollments', 'Enrolments', 'cap', 'enrollments'],
      ['wizard', 'New registration', 'plus', 'enrollments', 'C', { mode: 'new' }],
      ['wizard', 'Existing student', 'users', 'enrollments', 'C', { mode: 'existing' }],
      ['history', 'History', 'list', 'enrollments'],
    ],
  },
  { id: 'stu', label: 'Students', icon: 'user', tabs: [['students', 'Students', 'user', 'students']] },
  {
    id: 'pay',
    label: 'Payments',
    icon: 'wallet',
    tabs: [
      ['payCollect', 'Collect', 'wallet', 'payments'],
      ['payRecords', 'Records', 'list', 'payments'],
      ['receipts', 'Receipts', 'file', 'payments'],
      ['discountReq', 'Discount requests', 'tag', 'discount_requests'],
      ['refunds', 'Refunds', 'refresh', 'payments'],
    ],
  },
  {
    id: 'appr',
    label: 'Approvals & Requests',
    icon: 'shield',
    tabs: [
      ['approvals', 'Pending', 'shield', '*appr'],
      ['discountQueue', 'Discounts', 'tag', 'discount_requests'],
      ['transfers', 'Branch transfers', 'branch', 'branch_transfers'],
      ['reassign', 'Reassignment', 'users', 'reassignment'],
      ['approvalHistory', 'History', 'clock', '*appr'],
    ],
  },
  { id: 'rep', label: 'Reports', icon: 'chart', tabs: [['reports', 'Reports', 'chart', 'reports']] },
  {
    id: 'set',
    label: 'Settings',
    icon: 'gear',
    tabs: [
      ['config', 'Configuration', 'gear', 'configuration'],
      ['integration', 'LMS sync', 'link', '*any'],
      ['audit', 'Audit log', 'file', 'audit_logs'],
    ],
  },
];
const NAV = GROUPS.map((g) => [g.label, g.tabs]);
const PAGE_ALIAS = { lead: 'leads', opp: 'opps', student: 'students' };
const groupOf = (page) => {
  const p = PAGE_ALIAS[page] || page;
  return GROUPS.find((g) => g.tabs.some((t) => t[0] === p));
};
const visItem = (it) => {
  const r = it[3];
  if (r === null) return true;
  if (r === 'reassignment') return can(r, 'V') || can(r, 'C');
  if (r === '*appr') return anyApprove();
  if (r === '*any')
    return (
      can('configuration', 'V') ||
      (can('leads', 'V') && ['Admissions Head', 'Centre Administrator', 'Management'].includes(me().role))
    );
  if (it[4] === 'C') return can(r, 'C');
  return can(r, 'V');
};
const itParams = (it) => {
  const o = it[it.length - 1];
  return typeof o === 'object' && o && !Array.isArray(o) ? o : {};
};
const visTabs = (g) => g.tabs.filter(visItem);
const tabOn = (it, rt) => {
  const p = PAGE_ALIAS[rt.page] || rt.page;
  return (
    it[0] === p && (it[0] !== 'wizard' || rt.mode === itParams(it).mode || (!rt.mode && itParams(it).mode === 'new'))
  );
};
function sidebar() {
  const rt = S.route;
  const cur = groupOf(rt.page);
  const pend = S.approvals.filter((a) => a.status === 'Pending' && anyApprove() && inScope(a.branch)).length;
  const odue = S.tasks.filter(
    (t) =>
      t.status === 'Pending' &&
      new Date(t.due) < NOW &&
      (me().role === 'Counsellor' ? t.cslr === S.user : inScope(leadById(t.lead).branch)),
  ).length;
  return GROUPS.map((g) => {
    const v = visTabs(g);
    if (!v.length) return '';
    const it = v[0];
    const cnt =
      g.id === 'appr' && pend
        ? `<b class="cnt crit">${pend}</b>`
        : g.id === 'leads' && odue
          ? `<b class="cnt crit">${odue}</b>`
          : '';
    const p = itParams(it);
    return `<a class="it${cur === g ? ' on' : ''}" tabindex="0" data-act="go" data-page="${it[0]}"${Object.keys(p)
      .map((k) => ` data-${k}="${esc(p[k])}"`)
      .join('')} title="${esc(g.label)}">${ic(g.icon)}<span>${esc(g.label)}</span>${cnt}</a>`;
  }).join('');
}
function subtabs() {
  const rt = S.route,
    g = groupOf(rt.page);
  if (!g) return '';
  const v = visTabs(g);
  if (v.length < 2) return '';
  const pend = S.approvals.filter((a) => a.status === 'Pending' && anyApprove() && inScope(a.branch)).length;
  return `<nav class="tabs" aria-label="${esc(g.label)} sections">${v
    .map((it) => {
      const p = itParams(it);
      const c = it[0] === 'approvals' && pend ? ` <b class="cnt crit">${pend}</b>` : '';
      return `<a class="${tabOn(it, rt) ? 'on' : ''}" tabindex="0" data-act="go" data-page="${it[0]}"${Object.keys(p)
        .map((k) => ` data-${k}="${esc(p[k])}"`)
        .join('')}>${esc(it[1])}${c}</a>`;
    })
    .join('')}</nav>`;
}
const ACCESS = {
  leads: ['leads', 'V'],
  lead: ['leads', 'V'],
  tasks: ['leads', 'V'],
  calls: ['leads', 'V'],
  calendar: ['leads', 'V'],
  opps: ['opportunities', 'V'],
  lostOpps: ['opportunities', 'V'],
  admPipeline: ['opportunities', 'V'],
  admDecisions: ['opportunities', 'V'],
  enrollments: ['enrollments', 'V'],
  wizard: ['enrollments', 'C'],
  students: ['students', 'V'],
  student: ['students', 'V'],
  history: ['enrollments', 'V'],
  payCollect: ['payments', 'V'],
  payRecords: ['payments', 'V'],
  receipts: ['payments', 'V'],
  refunds: ['payments', 'V'],
  discountReq: ['discount_requests', 'V'],
  discountQueue: ['discount_requests', 'V'],
  transfers: ['branch_transfers', 'V'],
  reassign: ['reassignment', '*'],
  slaBreaches: ['leads', 'V'],
  reports: ['reports', 'V'],
  config: ['configuration', 'V'],
  audit: ['audit_logs', 'V'],
  approvals: ['*appr'],
  approvalHistory: ['*appr'],
  integration: ['*any'],
};
function allowed(rt) {
  const a = ACCESS[rt.page];
  if (!a) return true;
  if (a[0][0] === '*') return visItem([0, 0, 0, a[0]]);
  if (a[1] === '*') return can('reassignment', 'V') || can('reassignment', 'C');
  return can(a[0], a[1]);
}
function topbar() {
  const u = me(),
    un = visNotifs().filter((n) => !n.read).length;
  let sr = '';
  if (S.searchOpen && S.search.length >= 2) {
    const q = S.search.toLowerCase();
    const hits = [];
    leadScope().forEach((l) => {
      if ([l.id, l.student, l.parent, l.phone, l.email].some((x) => String(x).toLowerCase().includes(q)))
        hits.push(['Lead', l.student + ' · ' + l.id, lgo(l.id)]);
    });
    if (can('students', 'V'))
      S.students.forEach((s) => {
        if (!inScope(s.branch)) return;
        if (
          [
            s.id,
            s.first + ' ' + s.last,
            ...s.parents.map((p) => p.name),
            ...s.parents.map((p) => p.mobile),
            ...s.parents.map((p) => p.email),
          ].some((x) => String(x).toLowerCase().includes(q))
        )
          hits.push(['Student', s.first + ' ' + s.last + ' · ' + s.id, sgo(s.id)]);
      });
    sr = `<div class="sr">${
      hits
        .slice(0, 8)
        .map((h) => `<div ${h[2]}>${bdg(h[0], h[0] === 'Lead' ? 'info' : 'ok')}<span>${esc(h[1])}</span></div>`)
        .join('') || '<div class="muted">No matches in your branch scope</div>'
    }</div>`;
  }
  const users = ['S01', 'S03', 'S07', 'S09', 'S14', 'S10', 'S11', 'S12']
    .map((i) => S.staff.find((s) => s.id === i))
    .filter(Boolean);
  return `<header class="top"><button class="iconbtn mobtn" data-act="mobSide" aria-label="Open menu">${ic('menu')}</button><button class="iconbtn" data-act="toggleSide" aria-label="Collapse sidebar" style="${innerWidth <= 900 ? 'display:none' : ''}">${ic('menu')}</button>
  <div class="search">${ic('search')}<input id="gs" data-input="gsearch" autocomplete="off" placeholder="Search leads, students, phone, e-mail…" value="${esc(S.search)}">${sr}</div><div class="sp"></div>
  <button class="btn sm" data-act="simCall" title="Prototype: simulate an incoming call">${ic('phone')} Simulate incoming call</button>
  <button class="iconbtn" data-act="go" data-page="notifications" aria-label="Notifications">${ic('bell')}${un ? `<span class="dot">${un}</span>` : ''}</button>
  <div class="pm"><button class="row btn ghost" data-act="menu" style="padding:3px 6px"><span class="avatar">${initials(u.name)}</span><span style="text-align:left;line-height:1.2" class="hide-sm"><b style="font-size:12.5px">${esc(u.name)}</b><br><span class="muted xs">${esc(u.role)}</span></span>${ic('chevD')}</button>
  ${S.menu === 'user' ? `<div class="menu"><div class="mh"><b>${esc(u.name)}</b><div class="muted xs">${esc(u.role)} · ${esc(u.dept)}</div><div class="xs">Branch access: ${myScope().map(branchName).join(', ')}</div></div><div class="lab">Switch demo user (role preview)</div>${users.map((x) => `<div class="mi" data-act="setUser" data-u="${x.id}">${x.id === S.user ? ic('check') : '<span style="width:16px"></span>'}<span>${esc(x.name)}<span class="muted xs"> · ${esc(x.role)}${x.role === 'Admissions Head' ? ' (' + (roleScope(x).includes('BLR') ? 'India' : 'UAE') + ')' : ''}</span></span></div>`).join('')}<div class="lab">Display</div><div class="mi" data-act="theme">${ic('moon')} Toggle light / dark</div></div>` : ''}</div></header>`;
}
function shell() {
  const rt = S.route,
    pg = PAGES[rt.page];
  let body;
  if (!allowed(rt))
    body =
      ph('Access restricted', 'Your role does not include access to this screen.') +
      card(
        '',
        emptyBox(
          'Not available for ' + me().role,
          'Branch- and role-based access is configured under Roles & Permissions. Switch demo user from the profile menu to preview other roles.',
        ),
      );
  else {
    try {
      body = pg ? pg(rt) : ph('Not found', '');
    } catch (e) {
      console.error(e);
      body =
        ph('Something went wrong', '') +
        card('', `<div class="empty"><b>This screen failed to render</b>${esc(e.message)}</div>`);
    }
  }
  return `<div class="shell${S.collapsed ? ' collapsed' : ''}${S.shell ? ' mob' : ''}"><aside class="side"><div class="brand"><div class="logo">LOF</div><div><b>Lab of Future</b><small>CRM & Sales</small></div></div><nav class="nav" aria-label="Main">${sidebar()}</nav></aside><div class="main">${topbar()}<main class="content" id="main">${subtabs()}${body}</main></div></div>${modalHtml()}${S.callPop ? callPopHtml() : ''}`;
}
function render() {
  const ae = document.activeElement;
  const aid = ae && ae.id,
    ss = ae && ae.selectionStart,
    se = ae && ae.selectionEnd;
  const sc = $('#main') ? $('#main').scrollTop : 0;
  const ms = $('.modal .mb') ? $('.modal .mb').scrollTop : 0;
  document.documentElement.dataset.theme = S.theme || '';
  if (!S.theme) document.documentElement.removeAttribute('data-theme');
  $('#app').innerHTML = shell();
  if ($('#main')) $('#main').scrollTop = sc;
  if ($('.modal .mb')) $('.modal .mb').scrollTop = ms;
  if (aid) {
    const n = document.getElementById(aid);
    if (n) {
      n.focus();
      try {
        n.setSelectionRange(ss, se);
      } catch (e) {}
    }
  }
}
function modalHtml() {
  const m = S.modal;
  if (!m) return '';
  const def = MODALS[m.t];
  if (!def) return '';
  const x = def(m);
  return `<div class="ov" data-act="ovClose"><div class="modal ${x.size || ''}" role="dialog" aria-modal="true" aria-label="${esc(x.title)}"><div class="mh"><h3>${esc(x.title)}</h3><button class="iconbtn" data-act="closeModal" aria-label="Close">${ic('x')}</button></div>${x.form ? `<form id="mform" data-submit="${x.form}" novalidate><div class="mb">${x.body}</div></form>` : `<div class="mb">${x.body}</div>`}<div class="mf">${x.foot === false ? '' : x.foot || `<button class="btn" data-act="closeModal">Cancel</button>${x.form ? `<button class="btn ${x.danger ? 'danger' : 'primary'}" type="submit" form="mform">${esc(x.ok || 'Save')}</button>` : ''}`}</div></div></div>`;
}
const MODALS = {};
function callPopHtml() {
  const l = leadById(S.callPop);
  return `<div class="callpop" role="alertdialog"><div class="row" style="justify-content:space-between"><b>Incoming call ${SIMTAG}</b><span class="muted xs">${fT(nowIso())}</span></div><div style="margin:8px 0"><div class="mono">${esc(l.phone)}</div><div style="font-size:15px;font-weight:600">${esc(l.parent)}</div><div class="muted sm">Matched existing lead: ${esc(l.student)} · ${esc(PNAME(l.prog))} · ${esc(branchName(l.branch))}</div><div class="sm">Assigned to ${esc(staffName(l.cslr))} · ${catB(l.cat)}</div></div><div class="row"><button class="btn primary sm" data-act="answerCall">Answer & open lead</button><button class="btn sm" data-act="dismissCall">Dismiss</button></div></div>`;
}
Object.assign(ACT, {
  go(d) {
    const p = Object.assign({}, d);
    delete p.act;
    delete p.page;
    go(d.page, p);
  },
  toggleSide() {
    S.collapsed = !S.collapsed;
    render();
  },
  mobSide() {
    S.shell = !S.shell;
    render();
  },
  toggleSec(d) {
    S.open[d.s] = S.open[d.s] === false;
    render();
  },
  menu() {
    S.menu = S.menu ? null : 'user';
    render();
  },
  theme() {
    const dark =
      document.documentElement.dataset.theme === 'dark' ||
      (!S.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    S.theme = dark ? 'light' : 'dark';
    S.menu = null;
    render();
  },
  setUser(d) {
    S.user = d.u;
    S.menu = null;
    const u = me();
    addAudit('Access', 'Session', 'Switched demo user to ' + u.name + ' (' + u.role + ')', u.name);
    S.lf = {};
    S.dashF = { range: '30', branch: '', program: '', source: '', cslr: '' };
    S.payPick = null;
    go('dashboard');
    toast('Viewing as ' + u.name + ' · ' + u.role + ' · ' + myScope().map(branchName).join(', '));
  },
  closeModal() {
    closeModal();
  },
  ovClose(d, el, e) {
    if (e.target === el) closeModal();
  },
  simCall() {
    const c = leadScope().filter((l) => l.cslr);
    const l = c[Math.floor(Math.random() * c.length)] || S.leads[0];
    S.callPop = l.id;
    render();
  },
  answerCall() {
    const l = leadById(S.callPop);
    S.callPop = null;
    logCall(l, {
      dir: 'Incoming',
      outcome: 'Interested',
      dur: 4,
      status: 'Completed',
      notes: 'Answered via incoming-call pop-up (simulated)',
    });
    go('lead', { id: l.id });
    toast('Incoming call logged (simulated) and lead opened', 'ok');
  },
  dismissCall() {
    const l = leadById(S.callPop);
    S.callPop = null;
    S.calls.unshift({
      id: 'CL-' + String(S.seq.call++).padStart(3, '0'),
      lead: l.id,
      dir: 'Incoming',
      from: l.phone,
      to: 'LOF ' + branchName(l.branch),
      at: nowIso(),
      dur: 0,
      status: 'Missed',
      outcome: 'Missed',
      notes: 'Dismissed pop-up',
      rec: '',
      first: false,
      by: S.user,
      sim: true,
    });
    render();
  },
  confirmGo(d) {
    const m = S.modal;
    const f = CONFIRM[m.key];
    closeModal();
    f && f(m.args);
  },
});
const CONFIRM = {};
MODALS.confirm = (m) => ({
  title: m.title,
  size: 'sm2',
  body: `<p>${m.msg}</p>`,
  foot: `<button class="btn" data-act="closeModal">Cancel</button><button class="btn ${m.danger ? 'danger' : 'primary'}" data-act="confirmGo">${esc(m.ok || 'Confirm')}</button>`,
});
const confirmBox = (title, msg, key, args, ok, danger) =>
  openModal('confirm', { title, msg, key, args, ok, danger, noFocus: true });
