/* Student list and student record. */
/* ====== students ====== */
const stuVisible = (s) => inScope(s.branch) || S.enr.some((e) => e.stu === s.id && inScope(e.branch));
PAGES.students = () => {
  const q = (S.stuQ || '').toLowerCase();
  const ss = S.students.filter(
    (s) =>
      stuVisible(s) &&
      (!q ||
        [s.id, s.first + ' ' + s.last, ...s.parents.flatMap((p) => [p.name, p.mobile, p.email])].some((x) =>
          String(x).toLowerCase().includes(q),
        )),
  );
  return (
    ph('Student 360° Profiles', 'One master profile per student across programmes and branches') +
    card(
      '',
      `<div class="tb"><input type="search" id="sq" data-input="sq" placeholder="Search Student ID, student, parent name, mobile, email" value="${esc(S.stuQ || '')}" style="min-width:min(100%,360px)" aria-label="Search students"></div>` +
        table(
          'stu',
          [
            { h: 'Student ID', f: (s) => `<span class="mono">${s.id}</span>`, s: (s) => s.id },
            { h: 'Student', f: (s) => `<b>${esc(s.first + ' ' + s.last)}</b>`, s: (s) => s.first },
            { h: 'Age', f: (s) => age(s.dob), s: (s) => age(s.dob) },
            { h: 'Branch', f: (s) => esc(branchName(s.branch)) },
            {
              h: 'Current programme(s)',
              f: (s) =>
                esc(
                  S.enr
                    .filter((e) => e.stu === s.id && e.status === 'Active')
                    .map((e) => PNAME(e.prog))
                    .join(', ') || '—',
                ),
            },
            { h: 'Parent / guardian', f: (s) => esc(s.parents.map((p) => p.name).join(', ')) },
            { h: 'Membership', f: (s) => stB(s.status) },
            { h: 'LMS ID', f: (s) => s.moodle || '<span class="faint">—</span>' },
          ],
          ss,
          { ps: 12, row: (s) => sgo(s.id), et: 'No students found' },
        ),
      { np: 1 },
    )
  );
};
INP.sq = (el) => {
  S.stuQ = el.value;
  S.tbl.stu && (S.tbl.stu.page = 1);
  render();
};
const STABS = [
  ['overview', 'Overview'],
  ['parents', 'Parents'],
  ['programs', 'Programmes & history'],
  ['payments', 'Payments'],
  ['interests', 'Interests & education'],
  ['consents', 'Consents & documents'],
  ['comm', 'Communication'],
  ['moodle', 'LMS'],
];
const INTS = [
  'Space & Astronomy',
  'Robotics',
  'Artificial Intelligence',
  'Aeromodelling',
  '3D Designing & Printing',
  'Coding',
  'Electronics',
  'IoT',
  'Other',
];
PAGES.student = (rt) => {
  const s = stuById(rt.id);
  if (!s || !stuVisible(s))
    return ph('Student not found', '') + card('', emptyBox('Not found or outside your branch access'));
  const es = S.enr.filter((e) => e.stu === s.id),
    cur = es.filter((e) => e.status === 'Active'),
    tab = S.stuTab,
    E = can('students', 'E'),
    pay = can('payments', 'V'),
    pays = S.pay.filter((p) => p.stu === s.id);
  const head = `<div class="sum"><span class="avatar" style="width:54px;height:54px;font-size:18px">${initials(s.first + ' ' + s.last)}</span><div class="it"><small>Student ID (permanent)</small><b class="mono" style="font-size:15px">${s.id}</b> ${ic('shield')}</div><div class="it"><small>Name</small><b style="font-size:16px">${esc(s.first + ' ' + s.last)}</b></div><div class="it"><small>Age</small>${age(s.dob)}</div><div class="it"><small>Branch</small>${esc(branchName(s.branch))}</div><div class="it"><small>Current programme</small>${esc(cur.map((e) => PNAME(e.prog)).join(', ') || '—')}</div><div class="it"><small>Membership</small>${E ? `<select data-change="stuStatus" data-id="${s.id}" aria-label="Membership status">${['Active', 'Inactive', 'On Hold'].map((x) => `<option${s.status === x ? ' selected' : ''}>${x}</option>`).join('')}</select>` : stB(s.status)}</div><div class="it"><small>LMS ID</small>${s.moodle || '—'}</div><div class="it"><small>Family ID</small>${s.fam}</div></div>`;
  let b = '';
  if (tab === 'overview')
    b = `<div class="grid g2">${card(
      'Personal information',
      dl([
        ['Student ID', `<span class="mono">${s.id}</span> <span class="muted xs">(non-editable)</span>`],
        ['Name', esc(s.first + ' ' + s.last)],
        ['Date of birth', fD(s.dob) + ' · age ' + age(s.dob)],
        ['Gender', s.gender],
        ['Nationality', esc(s.nat)],
        ['School', esc(s.school)],
        ['Grade', esc(s.grade)],
        ['Curriculum', esc(s.curr)],
        ['Address', esc(s.address)],
      ]),
    )}${card(
      'Enrolment information',
      dl([
        ['First registration', fD(s.reg)],
        ['Branch', esc(branchName(s.branch))],
        ['Current programme', esc(cur.map((e) => PNAME(e.prog)).join(', ') || '—')],
        ['Membership status', stB(s.status)],
        ['Enrolments', es.length + ' total'],
        ['Branches attended', esc([...new Set(es.map((e) => branchName(e.branch)))].join(', '))],
      ]),
    )}</div>`;
  if (tab === 'parents')
    b = card(
      'Parents / guardians',
      table(
        'par',
        [
          { h: 'Name', f: (p) => esc(p.name) },
          { h: 'Relationship', f: (p) => p.rel },
          { h: 'Mobile', f: (p) => `<span class="mono">${esc(p.mobile)}</span>` },
          { h: 'Email', f: (p) => esc(p.email) },
          { h: 'Profession', f: (p) => esc(p.job) },
        ],
        s.parents,
        { all: 1 },
      ),
      {
        np: 1,
        act: E ? `<button class="btn sm" data-act="mParent" data-id="${s.id}">Add parent / guardian</button>` : '',
      },
    );
  if (tab === 'programs')
    b = card(
      'Programme history',
      table(
        'ph',
        [
          { h: 'Programme', f: (e) => esc(PNAME(e.prog)) },
          { h: 'Enrolled', f: (e) => fD(e.date) },
          { h: 'Branch', f: (e) => esc(branchName(e.branch)) },
          { h: 'Status', f: (e) => stB(e.status) },
          { h: 'Payment status', f: (e) => (pay ? stB(e.payStatus) : '—') },
          {
            h: 'Payment date',
            f: (e) => {
              const p = pays.filter((x) => x.enr === e.id).pop();
              return pay && p ? fD(p.at) : '—';
            },
          },
          { h: 'Paid', f: (e) => (pay ? money(e.paid, e.cur) : '—'), r: 1 },
          { h: 'LMS course', f: (e) => esc(e.course.moodleId) + ' · ' + esc(e.course.name) },
        ],
        es,
        { all: 1 },
      ),
      { np: 1 },
    );
  if (tab === 'payments')
    b = !pay
      ? card(
          '',
          emptyBox(
            'Restricted',
            'Payment information is visible to Reception, Centre Administrators, Admissions Heads, Management and System Administrators.',
          ),
        )
      : card(
          'Payment history',
          table(
            'pph',
            [
              { h: 'Date', f: (p) => fDT(p.at) },
              { h: 'Receipt', f: (p) => `<a data-act="receipt" data-id="${p.id}" class="mono">${p.rc}</a>` },
              { h: 'Enrolment', f: (p) => p.enr },
              { h: 'Amount', f: (p) => money(p.amt, p.cur), r: 1 },
              { h: 'Method', f: (p) => p.method },
              { h: 'Reference', f: (p) => esc(p.ref) },
              { h: 'Status', f: (p) => bdg(p.status, 'info') },
            ],
            pays,
            { all: 1, et: 'No payments' },
          ),
          { np: 1 },
        ) +
        '<div style="height:14px"></div>' +
        card(
          'Enrolment balances',
          table(
            'pbal',
            [
              { h: 'Enrolment', f: (e) => e.id },
              { h: 'Programme', f: (e) => esc(PNAME(e.prog)) },
              { h: 'Payable', f: (e) => money(e.total, e.cur), r: 1 },
              { h: 'Paid', f: (e) => money(e.paid, e.cur), r: 1 },
              { h: 'Outstanding', f: (e) => money(Math.max(0, e.total - e.paid), e.cur), r: 1 },
              {
                h: '',
                f: (e) =>
                  e.total > e.paid && e.status !== 'Withdrawn' && can('payments', 'C')
                    ? `<button class="btn sm primary" data-act="payFor" data-id="${e.id}">Collect payment</button>`
                    : '',
              },
            ],
            es,
            { all: 1 },
          ),
          { np: 1 },
        );
  if (tab === 'interests')
    b = `<div class="grid g2">${card('Interests & skills', `<div class="chips">${INTS.map((i) => `<a class="chip ${s.interests.includes(i) ? 'on' : ''}" tabindex="0" data-act="${E ? 'stuInt' : 'noop'}" data-id="${s.id}" data-i="${esc(i)}">${esc(i)}</a>`).join('')}</div>`)}${card(
      'Education & career',
      dl([
        ['Current school', esc(s.school)],
        ['University / college', esc(s.uni)],
        ['Course / degree', esc(s.degree)],
        ['LinkedIn', esc(s.linkedin)],
        ['Portfolio', esc(s.portfolio)],
      ]),
      { act: E ? `<button class="btn sm" data-act="mEdu" data-id="${s.id}">Edit</button>` : '' },
    )}</div>`;
  if (tab === 'moodle')
    b = card(
      'LMS calls',
      table(
        'smo',
        [
          { h: 'Call', f: (m) => m.id + ' · ' + msCall(m) },
          { h: 'Enrolment', f: (m) => m.enr },
          { h: 'Product', f: (m) => esc(m.course || '') + `<div class="mono muted xs">${esc(m.cid || '')}</div>` },
          { h: 'Credits', f: (m) => (m.credits || []).length, r: 1 },
          { h: 'Status', f: (m) => stB(m.status) },
          { h: 'Last attempt', f: (m) => fDT(m.last) },
          { h: 'Error', f: (m) => esc(m.err) },
        ],
        S.ms.filter((m) => m.stu === s.id),
        { all: 1 },
      ),
      { np: 1, act: `<button class="btn sm" data-act="go" data-page="integration">Open integration monitor</button>` },
    );
  if (tab === 'consents') {
    const dc = can('student_docs', 'V');
    b = `<div class="grid g2">${card(
      'Consents',
      dl([
        ['Photo / video consent', s.photoConsent === 'Granted' ? bdg('Granted', 'ok') : bdg(s.photoConsent, 'warn')],
        ['Consent date', s.consentDate ? fD(s.consentDate) : '—'],
        ['Consent document', dc ? esc(s.consentDoc) : '<span class="faint">Restricted</span>'],
      ]) +
        (E
          ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-act="stuConsent" data-id="${s.id}">${s.photoConsent === 'Granted' ? 'Withdraw consent' : 'Record consent & upload (simulated)'}</button></div>`
          : ''),
    )}${card(
      'Documents, photos & testimonials',
      dc
        ? table(
            'doc',
            [
              { h: 'Document', f: (d) => esc(d.n) },
              { h: 'Added', f: (d) => fD(d.d) },
            ],
            s.docs.concat(s.consentDoc ? [{ n: s.consentDoc, d: s.consentDate }] : []),
            { all: 1 },
          ) +
            (s.testimonials.length
              ? '<div class="sec" style="margin:10px 0 4px">Parent testimonials</div>' +
                s.testimonials.map((t) => `<p class="sm">${esc(t)}</p>`).join('')
              : '')
        : emptyBox(
            'Restricted',
            'Student documents are limited to Centre Administrators, Admissions Heads and System Administrators.',
          ),
      { np: dc },
    )}</div>`;
  }
  if (tab === 'comm')
    b = card(
      'Communication',
      table(
        'scm',
        [
          { h: 'When', f: (c) => fDT(c.at) },
          { h: 'Channel', f: (c) => c.ch },
          { h: 'Template', f: (c) => esc(c.tpl) },
          { h: 'Message', f: (c) => esc(c.text) },
          { h: 'Status', f: (c) => bdg(c.status, 'info') },
        ],
        s.comm,
        { all: 1, et: 'No messages recorded' },
      ),
      { np: 1 },
    );
  return `<div class="muted sm" style="margin-bottom:8px"><a ${goA('students')}>Students</a> / ${s.id}</div>${head}${tabsBar(STABS, tab, 'sTab')}${b}`;
};
Object.assign(ACT, {
  sTab(d) {
    S.stuTab = d.k;
    render();
  },
  stuInt(d) {
    const s = stuById(d.id),
      i = s.interests.indexOf(d.i);
    i >= 0 ? s.interests.splice(i, 1) : s.interests.push(d.i);
    addAudit('Student interests changed', s.id, s.interests.join(', '));
    render();
  },
  mParent: (d) => openModal('parent', { id: d.id }),
  mEdu: (d) => openModal('edu', { id: d.id }),
  stuConsent(d) {
    const s = stuById(d.id);
    if (s.photoConsent === 'Granted') {
      s.photoConsent = 'Withdrawn';
    } else {
      s.photoConsent = 'Granted';
      s.consentDate = TODAY;
      s.consentDoc = 'photo-consent-' + s.id.slice(-3) + '.pdf (simulated upload)';
    }
    addAudit('Consent changed', s.id, 'Photo/video: ' + s.photoConsent);
    render();
    toast('Consent updated', 'ok');
  },
  payFor(d) {
    S.payPick = d.id;
    go('payCollect');
  },
  receipt(d) {
    openModal('receipt', { id: d.id });
  },
});
CHG.stuStatus = (el) => {
  const s = stuById(el.dataset.id);
  s.status = el.value;
  addAudit('Membership status changed', s.id, el.value);
  render();
  toast('Membership status set to ' + el.value, 'ok');
};
MODALS.parent = (m) => ({
  title: 'Add parent / guardian',
  form: 'parent',
  body: `<input type="hidden" name="id" value="${m.id}"><div class="fgrid">${F('Name', 'name', { req: 1 })}${F('Relationship', 'rel', { opts: ['Father', 'Mother', 'Legal Guardian'] })}${F('Mobile', 'mobile', { req: 1 })}${F('Email', 'email', { t: 'email', req: 1 })}${F('Profession', 'job', {})}</div>`,
});
SUB.parent = (d, f) => {
  if (!need(f, d, ['name', 'mobile', 'email'])) return;
  stuById(d.id).parents.push({ name: d.name, rel: d.rel, email: d.email, mobile: d.mobile, job: d.job || '—' });
  addAudit('Parent added', d.id, d.name);
  closeModal();
  toast('Parent / guardian added', 'ok');
};
MODALS.edu = (m) => {
  const s = stuById(m.id);
  return {
    title: 'Education & career',
    form: 'edu',
    body: `<input type="hidden" name="id" value="${s.id}"><div class="fgrid">${F('Current school', 'school', { v: s.school })}${F('University / college', 'uni', { v: s.uni })}${F('Course / degree', 'degree', { v: s.degree })}${F('LinkedIn URL', 'linkedin', { v: s.linkedin })}${F('Portfolio URL', 'portfolio', { v: s.portfolio })}</div>`,
  };
};
SUB.edu = (d) => {
  const s = stuById(d.id);
  ['school', 'uni', 'degree', 'linkedin', 'portfolio'].forEach((k) => (s[k] = d[k]));
  addAudit('Student profile edited', s.id, 'Education & career');
  closeModal();
  toast('Saved', 'ok');
};
