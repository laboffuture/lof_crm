/* Admission pipeline and decisions, enrolments and history. */
/* ====== admissions ====== */
PAGES.admPipeline = () => {
  const os = visOpps().filter((o) => ['Admission Decision', 'Enrolled'].includes(o.stage));
  const cols = [
    ['Awaiting decision', (o) => o.stage === 'Admission Decision' && !o.decision],
    ['Accepted – ready to enrol', (o) => o.stage === 'Admission Decision' && o.decision === 'Accepted'],
    ['Waitlisted', (o) => o.stage === 'Admission Decision' && o.decision === 'Waitlisted'],
    ['Enrolled', (o) => o.stage === 'Enrolled'],
  ];
  return (
    ph('Admission Pipeline', 'From admission decision to enrolment') +
    `<div class="kb">${cols
      .map(
        (c) =>
          `<div class="kcol"><h4><span>${c[0]}</span><span>${os.filter(c[1]).length}</span></h4><div class="kl">${
            os
              .filter(c[1])
              .map(
                (o) =>
                  `<div class="kc" ${OGO(o)}><div class="n">${esc(o.student)}</div><div class="muted sm">${esc(PNAME(o.prog))} · ${esc(branchName(o.branch))}</div><div class="muted xs" style="margin-top:6px">${esc(o.next || '')}</div>${c[0].startsWith('Accepted') && can('enrollments', 'C') ? `<button class="btn sm primary" style="margin-top:6px" data-act="enrollOpp" data-id="${o.id}">Enrol</button>` : ''}</div>`,
              )
              .join('') || '<div class="muted xs" style="padding:8px">Empty</div>'
          }</div></div>`,
      )
      .join('')}</div>`
  );
};
PAGES.admDecisions = () => {
  const os = visOpps().filter((o) => o.stage === 'Admission Decision');
  return (
    ph('Admission Decisions', 'Record accept / waitlist / decline for opportunities in the Admission Decision stage') +
    card(
      '',
      table(
        'dec',
        [
          { h: 'Opportunity', f: (o) => o.id },
          { h: 'Prospect', f: (o) => `<b>${esc(o.student)}</b>` },
          { h: 'Programme', f: (o) => esc(PNAME(o.prog)) },
          { h: 'Branch', f: (o) => esc(branchName(o.branch)) },
          {
            h: 'Decision',
            f: (o) =>
              o.decision ? bdg(o.decision, o.decision === 'Accepted' ? 'ok' : 'warn') : bdg('Pending', 'warn'),
          },
          { h: 'Next action', f: (o) => esc(o.next) },
          {
            h: '',
            f: (o) =>
              can('opportunities', 'E')
                ? `<button class="btn sm" data-act="mDecision" data-id="${o.id}">Record decision</button> ${o.decision === 'Accepted' && can('enrollments', 'C') ? `<button class="btn sm primary" data-act="enrollOpp" data-id="${o.id}">Enrol</button>` : ''}`
                : '',
          },
        ],
        os,
        { all: 1, et: 'No pending admission decisions' },
      ),
      { np: 1 },
    )
  );
};
const enrCols = (act) =>
  [
    { h: 'Enrolment', f: (e) => `<span class="mono">${e.id}</span>`, s: (e) => e.id },
    {
      h: 'Student',
      f: (e) => {
        const s = stuById(e.stu);
        return `<a ${sgo(s.id)}>${esc(s.first + ' ' + s.last)}</a><div class="mono muted xs">${s.id}</div>`;
      },
      s: (e) => e.stu,
    },
    { h: 'Programme', f: (e) => esc(PNAME(e.prog)) },
    { h: 'Branch', f: (e) => esc(branchName(e.branch)) },
    { h: 'Enrolled', f: (e) => fD(e.date), s: (e) => e.date },
    { h: 'Status', f: (e) => stB(e.status) },
    { h: 'Fee (payable)', f: (e) => (can('payments', 'V') ? money(e.total, e.cur) : '—'), r: 1 },
    { h: 'Payment', f: (e) => (can('payments', 'V') ? stB(e.payStatus) : '—') },
    { h: 'Instalments', f: (e) => (can('payments', 'V') ? instSummary(e) : '—') },
    {
      h: 'LMS',
      f: (e) => {
        const m = S.ms.find((x) => x.id === e.ms);
        return m ? stB(m.status) : '—';
      },
    },
  ].concat(
    act
      ? [
          {
            h: '',
            f: (e) =>
              e.status === 'Active' || e.status === 'On Hold'
                ? `${can('enrollments', 'E') ? `<button class="btn sm danger" data-act="mWithdraw" data-id="${e.id}">Withdraw</button>` : ''}`
                : '',
          },
        ]
      : [],
  );
PAGES.enrollments = () => {
  const es = S.enr.filter((e) => inScope(e.branch));
  return (
    ph(
      'Enrollments',
      'Programme enrolments across your branches',
      can('enrollments', 'C')
        ? `<button class="btn" data-act="go" data-page="wizard" data-mode="existing">Existing student</button><button class="btn primary" data-act="go" data-page="wizard" data-mode="new">${ic('plus')} New student</button>`
        : '',
    ) + card('', table('enr', enrCols(1), es, { ps: 12, et: 'No enrolments' }), { np: 1 })
  );
};
PAGES.history = () => {
  const es = S.enr
    .filter((e) => inScope(e.branch))
    .sort((a, b) => (a.stu < b.stu ? -1 : a.stu > b.stu ? 1 : new Date(a.date) - new Date(b.date)));
  return (
    ph(
      'Program & Enrollment History',
      'Every enrolment per student, including completed and withdrawn programmes. History is retained after withdrawal.',
    ) +
    card(
      '',
      table(
        'hist',
        [
          { h: 'Student ID', f: (e) => `<a ${sgo(e.stu)} class="mono">${e.stu}</a>` },
          { h: 'Student', f: (e) => esc(stuById(e.stu).first + ' ' + stuById(e.stu).last) },
          { h: 'Programme', f: (e) => esc(PNAME(e.prog)) },
          { h: 'Enrolled', f: (e) => fD(e.date) },
          { h: 'Branch', f: (e) => esc(branchName(e.branch)) },
          { h: 'Programme status', f: (e) => stB(e.status) },
          { h: 'Payment', f: (e) => (can('payments', 'V') ? stB(e.payStatus) : '—') },
          { h: 'Paid', f: (e) => (can('payments', 'V') ? money(e.paid, e.cur) : '—'), r: 1 },
        ],
        es,
        { ps: 15 },
      ),
      { np: 1 },
    )
  );
};
ACT.mWithdraw = (d) => openModal('withdraw', { id: d.id });
Object.assign(ACT, {
  retrySync(d) {
    runSync(d.id);
  },
  msHist: (d) => openModal('msHist', { id: d.id }),
});
