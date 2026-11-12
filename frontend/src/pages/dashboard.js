/* View helpers shared by pages, and the role-based dashboard. */
/* ====== helpers for views ====== */
const inRange = (iso, r) =>
  r === 'all' || (r === 'month' ? dayKey(iso).startsWith('2026-10') : NOW - new Date(iso) <= +r * 864e5);
let optBranches = () => S.branches.filter((b) => inScope(b.id)).map((b) => [b.id, b.name]);
const optProgs = () => S.programs.filter((p) => p.active).map((p) => [p.id, p.name]);
const optCslr = (b) =>
  S.staff
    .filter((s) => s.role === 'Counsellor' && (!b || s.branch === b) && inScope(s.branch))
    .map((s) => [s.id, s.name + ' · ' + s.branch]);
const kgo = (page, lf, o) =>
  `data-act="kgo" data-page="${page}" data-lf='${esc(JSON.stringify(lf || {}))}'${o && o.preset ? ` data-preset="${o.preset}"` : ''}`;
ACT.kgo = (d) => {
  S.lf = JSON.parse(d.lf || '{}');
  S.tbl.leads = { page: 1, sort: null, dir: 1 };
  go(d.page, d.preset ? { preset: d.preset } : {});
};
function kpi(label, val, sub, attrs, kind) {
  return `<button class="kpi ${kind || ''}" ${attrs}><div class="l">${esc(label)}</div><div class="v">${val}</div><div class="s">${sub || '&nbsp;'}</div></button>`;
}
function visTasks() {
  const u = me();
  return S.tasks.filter((t) => {
    const l = leadById(t.lead);
    return l && inScope(l.branch) && (u.role !== 'Counsellor' || t.cslr === u.id);
  });
}
function visOpps() {
  const u = me();
  return S.opps.filter((o) => inScope(o.branch) && (u.role !== 'Counsellor' || o.cslr === u.id || true));
}
function dashData() {
  const u = me(),
    F = S.dashF;
  let base = leadScope().filter(
    (l) =>
      (!F.branch || l.branch === F.branch) &&
      (!F.program || l.prog === F.program) &&
      (!F.source || l.src === F.source) &&
      (u.role === 'Counsellor' ? l.cslr === u.id : !F.cslr || l.cslr === F.cslr),
  );
  const fl = base.filter((l) => inRange(l.enq, F.range));
  const tasks = visTasks().filter((t) => base.find((l) => l.id === t.lead));
  const opps = S.opps.filter(
    (o) =>
      base.find((l) => l.id === o.lead) ||
      (!F.program &&
        !F.source &&
        !F.cslr &&
        u.role !== 'Counsellor' &&
        inScope(o.branch) &&
        (!F.branch || o.branch === F.branch)),
  );
  return { u, F, base, fl, tasks, opps };
}
function pageDashboard() {
  const D = dashData(),
    { u, F, base, fl, tasks, opps } = D,
    role = u.role;
  const open = base.filter((l) => l.status === 'Open');
  const endToday = new Date(BASE + 864e5).getTime();
  const pt = tasks.filter((t) => t.status === 'Pending');
  const enrM = S.enr.filter(
    (e) =>
      inScope(e.branch) &&
      e.date.startsWith('2026-10') &&
      (!F.branch || e.branch === F.branch) &&
      (role !== 'Counsellor' || (e.opp && oppById(e.opp) && oppById(e.opp).cslr === u.id)),
  );
  const revM = S.pay
    .filter((p) => inScope(p.branch) && dayKey(p.at).startsWith('2026-10') && (!F.branch || p.branch === F.branch))
    .reduce((a, p) => a + toAED(p.amt, p.cur), 0);
  const K = {
    newToday: () =>
      kpi(
        'New leads today',
        base.filter((l) => dayKey(l.enq) === TODAY).length,
        'Enquiries received',
        kgo('leads', { from: TODAY, to: TODAY }, { preset: 'all' }),
      ),
    unassigned: () => {
      const n = open.filter((l) => !l.cslr).length;
      return kpi(
        'Unassigned leads',
        n,
        'Needs manual assignment',
        kgo('leads', {}, { preset: 'unassigned' }),
        n ? 'warn' : '',
      );
    },
    myOpen: () =>
      kpi(
        role === 'Counsellor' ? 'My open leads' : 'Open leads',
        open.length,
        'Weighted load ' +
          (role === 'Counsellor' ? load(u.id).w + ' / ' + u.max : open.reduce((a, l) => a + lw(l.cat), 0)),
        kgo('leads', { status: 'Open' }, { preset: role === 'Counsellor' ? 'mine' : 'all' }),
      ),
    hotAction: () => {
      const n = open.filter((l) => l.cat === 'Hot' && (!l.fc || (l.nextFU && new Date(l.nextFU) < endToday))).length;
      return kpi(
        'Hot leads needing action',
        n,
        'Due today, overdue or uncalled',
        kgo('leads', { category: 'Hot', status: 'Open', fu: 'due' }, { preset: 'Hot' }),
        n ? 'warn' : '',
      );
    },
    slaRisk: () => {
      const n = open.filter((l) => ['Breached', 'Due Soon'].includes(sla(l).s)).length,
        b = open.filter((l) => sla(l).s === 'Breached').length;
      return kpi(
        'First-call SLA at risk',
        n,
        b + ' breached · ' + (n - b) + ' due soon',
        kgo('leads', { sla: 'risk' }, { preset: 'all' }),
        b ? 'crit' : n ? 'warn' : '',
      );
    },
    fuToday: () =>
      kpi(
        'Follow-ups due today',
        pt.filter((t) => dayKey(t.due) === TODAY && new Date(t.due) >= NOW).length,
        'Scheduled for later today',
        goA('tasks', { tab: 'today' }),
      ),
    fuOverdue: () => {
      const n = pt.filter((t) => new Date(t.due) < NOW).length;
      return kpi(
        'Overdue follow-ups',
        n,
        'Escalates after ' + S.cfg.sla.escMins + ' min',
        goA('tasks', { tab: 'overdue' }),
        n ? 'crit' : '',
      );
    },
    oppsProg: () =>
      kpi(
        'Opportunities in progress',
        opps.filter((o) => ['Opportunity', 'Admission Decision'].includes(o.stage)).length,
        'Opportunity + Admission Decision',
        goA('opps'),
      ),
    admissions: () => kpi('Admissions completed', enrM.length, 'This month', goA('enrollments')),
    revenue: () =>
      kpi(
        'Revenue collected',
        Math.round(revM).toLocaleString('en-US'),
        'AED equivalent · this month',
        goA('payRecords'),
      ),
    discPending: () => {
      const n = S.approvals.filter(
        (a) => a.type === 'Exceptional Discount' && a.status === 'Pending' && inScope(a.branch),
      ).length;
      return kpi('Pending discount approvals', n, 'Exceptional discounts', goA('discountQueue'), n ? 'warn' : '');
    },
    moodleFail: () => {
      const n = S.ms.filter(
        (m) => ['Failed', 'Retry Required'].includes(m.status) && inScope(enrById(m.enr).branch),
      ).length;
      return kpi('LMS sync failures', n, 'Failed or retry required', goA('integration'), n ? 'crit' : '');
    },
    outstanding: () =>
      kpi(
        'Outstanding balances',
        Math.round(
          S.enr
            .filter((e) => inScope(e.branch) && e.status === 'Active')
            .reduce((a, e) => a + toAED(Math.max(0, e.total - e.paid), e.cur), 0),
        ).toLocaleString('en-US'),
        'AED equivalent · active enrolments',
        goA('payCollect'),
      ),
    myTarget: () => tgtTile(u),
    overdueInst: () => instTile(),
    awaiting: () =>
      kpi(
        'Accepted – awaiting enrolment',
        S.opps.filter((o) => o.decision === 'Accepted' && o.stage === 'Admission Decision' && inScope(o.branch)).length,
        'Ready for payment & enrolment',
        goA('admDecisions'),
      ),
  };
  const SETS = {
    Counsellor: ['myTarget', 'myOpen', 'hotAction', 'slaRisk', 'fuToday', 'fuOverdue', 'oppsProg', 'admissions'],
    'Centre Administrator': [
      'newToday',
      'unassigned',
      'slaRisk',
      'fuToday',
      'fuOverdue',
      'oppsProg',
      'admissions',
      'revenue',
      'moodleFail',
    ],
    'Admissions Head': [
      'newToday',
      'unassigned',
      'hotAction',
      'slaRisk',
      'fuOverdue',
      'oppsProg',
      'admissions',
      'discPending',
      'moodleFail',
    ],
    Reception: ['revenue', 'outstanding', 'overdueInst', 'awaiting', 'admissions', 'moodleFail'],
    Management: [
      'newToday',
      'unassigned',
      'slaRisk',
      'fuOverdue',
      'oppsProg',
      'admissions',
      'revenue',
      'discPending',
      'moodleFail',
    ],
    'System Administrator': ['newToday', 'unassigned', 'slaRisk', 'moodleFail', 'discPending', 'revenue', 'admissions'],
  };
  const sb = optBranches();
  const filters = `<div class="card" style="margin-bottom:14px"><div class="tb">${sb.length > 1 ? `<select name="branch" data-change="dash" aria-label="Branch"><option value="">All branches</option>${sb.map((b) => `<option value="${b[0]}"${F.branch === b[0] ? ' selected' : ''}>${b[1]}</option>`).join('')}</select>` : `<span class="badge info">${esc(branchName(sb[0][0]))}</span>`}
   <select name="range" data-change="dash" aria-label="Date range">${[
     ['1', 'Today'],
     ['7', 'Last 7 days'],
     ['30', 'Last 30 days'],
     ['month', 'This month'],
     ['all', 'All time'],
   ]
     .map((x) => `<option value="${x[0]}"${F.range === x[0] ? ' selected' : ''}>${x[1]}</option>`)
     .join('')}</select>
   <select name="program" data-change="dash" aria-label="Programme"><option value="">All programmes</option>${optProgs()
     .map((p) => `<option value="${p[0]}"${F.program === p[0] ? ' selected' : ''}>${p[1]}</option>`)
     .join('')}</select>
   <select name="source" data-change="dash" aria-label="Source"><option value="">All sources</option>${SRC_LIST.map((s) => `<option${F.source === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
   ${
     role !== 'Counsellor'
       ? `<select name="cslr" data-change="dash" aria-label="Counsellor"><option value="">All counsellors</option>${optCslr()
           .map((c) => `<option value="${c[0]}"${F.cslr === c[0] ? ' selected' : ''}>${c[1]}</option>`)
           .join('')}</select>`
       : ''
   }
   <span class="muted xs" style="margin-left:auto">Date range applies to charts. KPI cards show live status.</span></div></div>`;
  const reach = (l, n) => LSTAGES.indexOf(l.stage) >= n || l.status === 'Converted';
  const ff = fl.length ? fl : [];
  const oppE = S.opps.filter((o) => o.stage === 'Enrolled' && ff.find((l) => l.id === o.lead)).length;
  const lostN =
    ff.filter((l) => ['Lost', 'Closed'].includes(l.status)).length +
    S.opps.filter((o) => o.stage === 'Lost' && ff.find((l) => l.id === o.lead)).length;
  const fun = funnel([
    { l: 'New lead', v: ff.length, go: kgo('leads', {}, { preset: 'all' }) },
    {
      l: 'Contacted',
      v: ff.filter((l) => reach(l, 1)).length,
      go: kgo('leads', { stage: 'Contacted' }, { preset: 'all' }),
    },
    {
      l: 'Qualified',
      v: ff.filter((l) => reach(l, 2)).length,
      go: kgo('leads', { stage: 'Qualified' }, { preset: 'all' }),
    },
    { l: 'Opportunity', v: ff.filter((l) => l.status === 'Converted').length, go: goA('opps') },
    { l: 'Enrolled', v: oppE, c: 'var(--c4)', go: goA('enrollments') },
    { l: 'Lost / closed', v: lostN, c: 'var(--c6)', go: kgo('leads', { status: 'Closed' }, { preset: 'all' }) },
  ]);
  const temp = donut(
    CATS.map((c) => ({
      l: c,
      v: ff.filter((l) => l.cat === c).length,
      c: CATCOL[c],
      go: kgo('leads', { category: c }, { preset: 'all' }).replace('data-act="kgo"', 'data-act="kgo"'),
    })),
  );
  const brs = optBranches().filter((b) => !F.branch || b[0] === F.branch);
  const brPerf = bars(
    brs
      .map((b) => ({
        l: b[1] + ' – admissions',
        v: S.enr.filter((e) => e.branch === b[0] && e.date.startsWith('2026-10')).length,
        go: goA('enrollments'),
      }))
      .concat(
        brs.map((b) => ({
          l: b[1] + ' – collected (AED k)',
          v:
            Math.round(
              S.pay
                .filter((p) => p.branch === b[0] && dayKey(p.at).startsWith('2026-10'))
                .reduce((a, p) => a + toAED(p.amt, p.cur), 0) / 100,
            ) / 10,
          c: 'var(--c2)',
        })),
      ),
    { fmt: (v) => v },
  );
  const srcP = bars(
    SRC_LIST.map((s) => {
      const x = ff.filter((l) => l.src === s);
      return {
        l: s + ' · ' + x.filter((l) => l.status === 'Converted').length + ' converted',
        v: x.length,
        go: kgo('leads', { source: s }, { preset: 'all' }),
      };
    }),
  );
  const cs = optCslr().map((c) => c[0]);
  const conv = bars(
    S.staff
      .filter((s) => cs.includes(s.id) && (!F.cslr || s.id === F.cslr))
      .map((s) => {
        const x = ff.filter((l) => l.cslr === s.id);
        return {
          l: s.name,
          v: x.length ? Math.round((x.filter((l) => l.status === 'Converted').length / x.length) * 100) : 0,
        };
      }),
    { fmt: (v) => v + '%', max: 100 },
  );
  const mths = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const tgt = brs.reduce((a, b) => a + S.branches.find((x) => x.id === b[0]).tAdm, 0);
  const ach = mths.map((m, i) =>
    brs.reduce(
      (a, b) =>
        a + (i < 5 ? S.hist[b[0]][i] : S.enr.filter((e) => e.branch === b[0] && e.date.startsWith('2026-10')).length),
      0,
    ),
  );
  const mx = Math.max(tgt, ...ach, 1);
  const tva = `<svg viewBox="0 0 360 150" width="100%" role="img" aria-label="Monthly target versus achievement">${[0, 0.5, 1].map((f) => `<line x1="30" x2="350" y1="${120 - f * 100}" y2="${120 - f * 100}" stroke="var(--line2)"/><text x="26" y="${123 - f * 100}" text-anchor="end" font-size="9" fill="var(--muted)">${Math.round(mx * f)}</text>`).join('')}${mths.map((m, i) => `<rect x="${42 + i * 52}" y="${120 - (ach[i] / mx) * 100}" width="26" height="${(ach[i] / mx) * 100}" fill="var(--c1)" rx="2"><title>${m}: ${ach[i]} admissions</title></rect><text x="${55 + i * 52}" y="136" text-anchor="middle" font-size="10" fill="var(--muted)">${m}</text><text x="${55 + i * 52}" y="${116 - (ach[i] / mx) * 100}" text-anchor="middle" font-size="9" fill="var(--fg)">${ach[i]}</text>`).join('')}<line x1="30" x2="350" y1="${120 - (tgt / mx) * 100}" y2="${120 - (tgt / mx) * 100}" stroke="var(--c5)" stroke-dasharray="4 3" stroke-width="1.5"/><text x="350" y="${114 - (tgt / mx) * 100}" text-anchor="end" font-size="9" fill="var(--c5)">Monthly target ${tgt}</text></svg><div class="legend"><span><i style="background:var(--c1)"></i>Admissions achieved</span><span><i style="background:var(--c5)"></i>Target</span></div>`;
  const fs = ['Overdue', 'Due today', 'Upcoming', 'Completed'];
  const fv = [
    pt.filter((t) => new Date(t.due) < NOW).length,
    pt.filter((t) => dayKey(t.due) === TODAY && new Date(t.due) >= NOW).length,
    pt.filter((t) => dayKey(t.due) > TODAY).length,
    tasks.filter((t) => t.status === 'Done').length,
  ];
  const fut = bars(
    fs.map((s, i) => ({
      l: s,
      v: fv[i],
      c: ['var(--c6)', 'var(--c5)', 'var(--c1)', 'var(--c4)'][i],
      go: goA('tasks', { tab: ['overdue', 'today', 'upcoming', 'done'][i] }),
    })),
  );
  const show = {
    fun: role !== 'Reception',
    temp: role !== 'Reception',
    br:
      ['Management', 'Admissions Head', 'System Administrator', 'Centre Administrator', 'Reception'].includes(role) &&
      brs.length > 0,
    src: role !== 'Reception' && role !== 'System Administrator',
    conv: ['Management', 'Admissions Head', 'Centre Administrator'].includes(role),
    tva: ['Management', 'Admissions Head', 'Centre Administrator'].includes(role),
    fu: ['Counsellor', 'Centre Administrator', 'Admissions Head'].includes(role),
  };
  const mine =
    role === 'Counsellor'
      ? card(
          'My workload',
          `<div class="row" style="justify-content:space-between"><div><div class="muted xs">Weighted workload</div><div style="font-size:22px;font-weight:600;color:var(--navy)">${load(u.id).w} / ${u.max}</div></div><div class="legend" style="flex-direction:column;gap:4px"><span><i style="background:var(--c6)"></i>Hot ${load(u.id).Hot} × ${lw('Hot')}</span><span><i style="background:var(--c5)"></i>Warm ${load(u.id).Warm} × ${lw('Warm')}</span><span><i style="background:var(--c1)"></i>Cold ${load(u.id).Cold} × ${lw('Cold')}</span></div></div><div class="bar" style="grid-template-columns:1fr;margin-top:10px"><div class="tr"><i style="width:${Math.min(100, (load(u.id).w / u.max) * 100)}%"></i></div></div><p class="muted sm" style="margin:8px 0 0">Converted leads are excluded from open-lead workload.</p>`,
        )
      : '';
  return (
    ph(
      'CRM Dashboard',
      `Signed in as <b>${esc(u.name)}</b> · ${esc(role)} · ${myScope().length > 1 ? 'all permitted branches' : esc(branchName(myScope()[0]))}`,
      `<button class="btn primary" data-act="openNewLead">${ic('plus')} New lead</button>`,
    ) +
    simBanner() +
    filters +
    `<div class="kpis">${SETS[role].map((k) => K[k]()).join('')}</div><div class="grid g2">${show.fun ? card('Lead funnel', fun) : ''}${show.temp ? card('Lead temperature', temp) : ''}${mine}${show.fu ? card('Follow-up task status', fut) : ''}${show.br ? card('Branch performance – this month', brPerf) : ''}${show.tva ? card('Monthly target vs achievement', tva) : ''}${show.src ? card('Lead source performance', srcP) : ''}${show.conv ? card('Counsellor conversion rate', conv) : ''}</div>`
  );
}
PAGES.dashboard = pageDashboard;
CHG.dash = (el) => {
  S.dashF[el.name] = el.value;
  render();
};
ACT.openNewLead = () => openModal('leadForm', {});
