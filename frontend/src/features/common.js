/* Shared date helpers for version 2 features and their demo data (seedExtras). */
/* ====== counsellor targets · payment terms · refund rules · LMS integration ====== */
const curMonth = () => TODAY.slice(0, 7);
const monthAdd = (m, n) => {
  const p = m.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthName = (m) =>
  new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const addMonthsDay = (day, n) => {
  const p = day.split('-').map(Number);
  const last = new Date(Date.UTC(p[0], p[1] + n, 0, 12)).getUTCDate();
  return new Date(Date.UTC(p[0], p[1] - 1 + n, Math.min(p[2], last), 12)).toISOString().slice(0, 10);
};
const dayFmt = (d) => (d ? fD(d + 'T12:00:00+04:00') : '—');
const brCur = (b) => (S.branches.find((x) => x.id === b) || { cur: 'AED' }).cur;

/* seed data for the new settings (called from seed()) */
function seedExtras(st) {
  const m = TODAY.slice(0, 7),
    pm = monthAdd(m, -1),
    cur = (b) => st.branches.find((x) => x.id === b).cur;
  st.cfg.targets = [];
  [pm, m].forEach((mm) =>
    st.staff
      .filter((s) => s.role === 'Counsellor')
      .forEach((s) => {
        const inr = cur(s.branch) === 'INR';
        st.cfg.targets.push({ m: mm, c: s.id, enr: inr ? 4 : 6, rev: inr ? 240000 : 16000, conv: 25 });
      }),
  );
  st.cfg.payTerms = [
    { id: 'PT1', name: 'Full payment', split: [100], gap: 0, minFirst: 100, grace: 0, active: true },
    { id: 'PT2', name: '50 / 50', split: [50, 50], gap: 30, minFirst: 50, grace: 7, active: true },
    { id: 'PT3', name: '40 / 30 / 30', split: [40, 30, 30], gap: 21, minFirst: 40, grace: 7, active: true },
    { id: 'PT4', name: 'Quarterly (4 × 25%)', split: [25, 25, 25, 25], gap: 90, minFirst: 25, grace: 10, active: true },
  ];
  st.cfg.payTermDefault = 'PT1';
  st.cfg.refund = {
    rules: [
      { label: 'Cooling-off', days: 7, sessions: 2, pct: 100 },
      { label: 'Early withdrawal', days: 30, sessions: 6, pct: 75 },
      { label: 'Mid-term', days: 60, sessions: 12, pct: 50 },
      { label: 'Late withdrawal', days: 90, sessions: 18, pct: 25 },
    ],
    regFee: 'retain',
    adminFee: { AED: 100, INR: 1500 },
    tax: 'refund',
    approver: 'Management',
    confirmed: false,
  };
  st.cfg.lms = { validMonths: 12, programmes: {}, branchMap: {}, confirmed: false };
  st.programs.forEach((p, i) => {
    const code = p.id + '-TRK-' + (10021 + i * 1000);
    st.cfg.lms.programmes[p.id] = { track: code, credits: [...Array(p.credits)].map((_, k) => code + '-C' + (k + 1)) };
  });
  st.branches.forEach((b) => {
    st.cfg.lms.branchMap[b.id] = b.id + '01';
  });
  st.cfg.integ.lms = { on: false, retryMax: 3, retryMin: 15, notify: 'Admissions Head, System Administrator' };
  delete st.cfg.integ.moodle;
  const termOf = { 'EN-26-0002': 'PT2', 'EN-26-0004': 'PT3' };
  st.enr.forEach((e) => {
    e.term = termOf[e.id] || 'PT1';
    e.sched = buildSched(
      st.cfg.payTerms.find((t) => t.id === e.term),
      e.total,
      e.date,
    );
    const o = e.opp && st.opps.find((x) => x.id === e.opp);
    e.cslr = o ? o.cslr : null;
  });
  st.ms.forEach((x) => {
    const e = st.enr.find((y) => y.id === x.enr),
      c = st.cfg.lms.programmes[e.prog];
    x.op = 'enrol';
    x.cid = c.track;
    x.credits = c.credits.slice();
    x.course = st.programs.find((p) => p.id === e.prog).name + ' · ' + e.pkg;
  });
  st.refunds.forEach((r) => {
    Object.assign(r, {
      sessions: 6,
      days: 30,
      suggested: r.amt,
      rule: 'Early withdrawal (75%)',
      exception: false,
      approverRole: 'Management',
      note: '',
    });
  });
}
