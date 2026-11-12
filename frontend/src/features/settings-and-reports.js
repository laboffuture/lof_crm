/* Settings tabs and reports added in version 2. */
/* ---------- settings tabs & reports ---------- */
(() => {
  const i = CTABS.findIndex((t) => t[0] === 'fees');
  CTABS.splice(i + 1, 0, ['payTerms', 'Payment Terms'], ['refund', 'Refund Rules']);
  CTABS.splice(CTABS.findIndex((t) => t[0] === 'integrations') + 1, 0, ['lms', 'LMS Integration']);
  CTABS.splice(CTABS.findIndex((t) => t[0] === 'routing') + 1, 0, ['targets', 'Counsellor Targets']);
})();
for (let i = INTEG.length - 1; i >= 0; i--) if (INTEG[i][0] === 'moodle') INTEG.splice(i, 1);
RDEF.find((r) => r[0] === 'r17')[1] = 'LMS Sync Status Report';
RDEF.find((r) => r[0] === 'r18')[1] = 'LMS Integration Failure Report';
RDEF.push(['r21', 'Counsellor Target vs Achievement'], ['r22', 'Instalment Status Report']);
REP.r17 = () => {
  const ms = S.ms.filter((m) => inScope(enrById(m.enr).branch));
  const st = ['Success', 'Processing', 'Pending', 'Failed', 'Retry Required'];
  return {
    cols: ['Call', 'Type', 'Student', 'Enrolment', 'Track', 'Credits', 'Status', 'Last attempt', 'Attempts'],
    rows: ms.map((m) => [
      m.id,
      msCall(m),
      stuById(m.stu).first + ' ' + stuById(m.stu).last + ' (' + m.stu + ')',
      m.enr,
      m.cid || '—',
      (m.credits || []).length,
      m.status,
      fDT(m.last),
      m.attempts,
    ]),
    chart: st.map((k) => ({ l: k, v: ms.filter((m) => m.status === k).length })),
  };
};
REP.r18 = () => ({
  cols: ['Call', 'Type', 'Student', 'Enrolment', 'Status', 'Attempts', 'Last attempt', 'Error'],
  rows: S.ms
    .filter((m) => ['Failed', 'Retry Required'].includes(m.status) && inScope(enrById(m.enr).branch))
    .map((m) => [
      m.id,
      msCall(m),
      stuById(m.stu).first + ' ' + stuById(m.stu).last,
      m.enr,
      m.status,
      m.attempts,
      fDT(m.last),
      m.err,
    ]),
});
REP.r21 = () => {
  const m = curMonth();
  const rows = RCs().map((s) => {
    const t = tgtFor(s.id, m) || { enr: 0, rev: 0, conv: 0 },
      a = tgtAch(s.id, m),
      cur = brCur(s.branch);
    return [
      s.name,
      branchName(s.branch),
      t.enr,
      a.enr,
      pctN(a.enr, t.enr) + '%',
      money(t.rev, cur),
      money(a.rev, cur),
      pctN(a.rev, t.rev) + '%',
      t.conv + '%',
      a.conv + '%',
    ];
  });
  return {
    cols: [
      'Counsellor',
      'Branch',
      'Enrolment target',
      'Enrolled',
      '% of target',
      'Revenue target',
      'Revenue booked',
      '% of target',
      'Conversion target',
      'Conversion',
    ],
    rows,
    chart: rows.map((r) => ({ l: r[0], v: parseInt(r[4]) })),
    note:
      monthName(m) +
      '. Revenue is the enrolment value excluding tax, in the branch currency; conversion = enrolments ÷ leads assigned in the month. Chart shows % of enrolment target.',
  };
};
REP.r22 = () => {
  const rows = [];
  RE().forEach((e) => {
    const s = stuById(e.stu),
      r = instStatus(e);
    r.forEach((i) =>
      rows.push([
        e.id,
        s.first + ' ' + s.last,
        branchName(e.branch),
        termName(e.term),
        i.n + ' of ' + r.length,
        i.due,
        money(i.amt, e.cur),
        money(i.paid, e.cur),
        money(i.bal, e.cur),
        i.st,
      ]),
    );
  });
  rows.sort((a, b) => (a[5] < b[5] ? -1 : 1));
  const st = ['Paid', 'Upcoming', 'Due', 'Partly paid', 'Overdue', 'Overdue (part paid)', 'Closed'];
  return {
    cols: [
      'Enrolment',
      'Student',
      'Branch',
      'Payment term',
      'Instalment',
      'Due date',
      'Amount',
      'Paid',
      'Balance',
      'Status',
    ],
    rows,
    chart: st.map((k) => ({ l: k, v: rows.filter((r) => r[9] === k).length })).filter((x) => x.v),
    note: 'Overdue = unpaid after the due date plus the term’s grace days. Payments are applied to the earliest instalment first.',
  };
};

const wizTerm = (d) => (termById(d.term) && termById(d.term).active ? d.term : S.cfg.payTermDefault);
