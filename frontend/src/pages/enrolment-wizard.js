/* Three-step registration and enrolment wizard. */
/* ====== enrolment wizard ====== */
const WSTEPS = ['Student', 'Programme & fees', 'Payment & confirm'];
// A shared parent contact identifies a family, not necessarily the same child.
function wizStudentMatches(d) {
  const text = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  const name = text(d.first + ' ' + d.last),
    email = text(d.semail);
  return S.students.filter(
    (s) =>
      (email && text(s.email) === email) ||
      (d.first && d.last && d.dob && text(s.first + ' ' + s.last) === name && s.dob === d.dob),
  );
}
ACT.enrollOpp = (d) => {
  const o = oppById(d.id),
    l = leadById(o.lead);
  const m = S.students.find((s) =>
    s.parents.some((p) => normPh(p.mobile) === normPh(l.phone) || p.email.toLowerCase() === l.email.toLowerCase()),
  );
  const nm = o.student.split(' ');
  S.wiz = {
    mode: m ? 'existing' : 'new',
    step: 1,
    opp: o.id,
    stu: m ? m.id : null,
    d: {
      first: nm[0],
      last: nm.slice(1).join(' '),
      dob: l.dob,
      school: l.school,
      grade: l.grade,
      curr: l.curr,
      pname: l.parent,
      pmob: l.phone,
      pemail: l.email,
      prel: 'Father',
      branch: o.branch,
      prog: o.prog,
      pkg: o.pkg,
    },
  };
  go('wizard', { mode: S.wiz.mode });
};
PAGES.wizard = (rt) => {
  if (!S.wiz || (rt.mode && S.wiz.mode !== rt.mode && !S.wiz.opp)) {
    S.wiz = {
      mode: rt.mode || 'new',
      step: 1,
      opp: null,
      stu: null,
      d: { branch: optBranches()[0][0], prel: 'Father', pkg: 'Term (24 sessions)' },
    };
  }
  const w = S.wiz,
    d = w.d;
  const steps = `<div class="step">${WSTEPS.map((s, i) => `<div class="${w.step === i + 1 ? 'on' : w.step > i + 1 ? 'dn' : ''}">${i + 1}. ${s}</div>`).join('')}</div>`;
  const flow =
    w.mode === 'new'
      ? 'Admission → New Student → Student ID generation → Enrolment → LMS synchronisation'
      : 'Admission → Identify existing student → Reuse Student ID → Additional programme enrolment → Existing LMS account';
  let body = '';
  if (w.step === 1) {
    const opps = visOpps().filter((o) => !['Enrolled', 'Lost'].includes(o.stage));
    const link = `<div class="fgrid">${F('Linked admission (opportunity)', 'opp', { v: w.opp || '', opts: opps.map((o) => [o.id, o.student + ' · ' + PNAME(o.prog) + (o.decision ? ' · ' + o.decision : '')]), blank: 'None – walk-in enrolment', chg: 'wizOpp' })}</div>`;
    if (w.mode === 'existing') {
      const q = (S.wizQ || '').toLowerCase();
      const res =
        q.length >= 2
          ? S.students.filter((s) =>
              [s.id, s.first + ' ' + s.last, ...s.parents.flatMap((p) => [p.name, p.mobile, p.email])].some((x) =>
                String(x).toLowerCase().includes(q),
              ),
            )
          : [];
      const st = w.stu && stuById(w.stu);
      body =
        link +
        `<div class="sec" style="margin-top:14px">Identify existing student</div><div class="f"><label for="wsq">Search by Student ID, student name, parent name, mobile or email</label><input id="wsq" data-input="wsq" value="${esc(S.wizQ || '')}" placeholder="e.g. LOF-26-000001 or +971 50 555 0311"></div>${res.length ? `<div class="card" style="margin-top:10px"><div class="list">${res.map((s) => `<div><span><b>${esc(s.first + ' ' + s.last)}</b> <span class="mono muted">${s.id}</span><br><span class="muted xs">${esc(s.parents.map((p) => p.name).join(', '))} · ${esc(branchName(s.branch))}</span></span><button class="btn sm ${w.stu === s.id ? 'primary' : ''}" data-act="wizPick" data-id="${s.id}">${w.stu === s.id ? 'Selected' : 'Select'}</button></div>`).join('')}</div></div>` : q.length >= 2 ? emptyBox('No student found', 'Check the spelling or switch to New student.') : ''}${st ? `<div class="banner" style="margin-top:12px;background:var(--ok-bg);color:var(--ok)">${ic('check')}<span>Existing student <b>${esc(st.first + ' ' + st.last)}</b> selected. Student ID <b class="mono">${st.id}</b> will be reused; the LMS matches the student by this ID.</span></div>` : ''}`;
    } else
      body =
        link +
        `<form id="wf1" data-submit="wizStep1"><div id="dupbox"></div><div class="fgrid"><div class="sec">Student</div>${F('First name', 'first', { v: d.first, req: 1 })}${F('Last name', 'last', { v: d.last, req: 1 })}${F('Date of birth', 'dob', { t: 'date', v: d.dob, req: 1, help: 'Age is calculated automatically.' })}${F('Gender', 'gender', { opts: ['Female', 'Male', 'Other'], v: d.gender || 'Female' })}${F('Nationality', 'nat', { v: d.nat })}${F('Student e-mail', 'semail', { t: 'email', v: d.semail, help: 'Required for LMS delivery. Use the student’s LMS account email, different from the parent’s.' })}${F('Student mobile', 'smob', { v: d.smob, help: 'Optional, with country code.' })}${F('School', 'school', { v: d.school })}${F('Grade', 'grade', { v: d.grade })}${F('Curriculum / board', 'curr', { v: d.curr })}${F('Address', 'address', { v: d.address, full: 1 })}<div class="sec">Parent / guardian</div>${F('Name', 'pname', { v: d.pname, req: 1 })}${F('Relationship', 'prel', { opts: ['Father', 'Mother', 'Legal Guardian'], v: d.prel })}${F('Mobile', 'pmob', { v: d.pmob, req: 1, chg: 'wizDup' })}${F('Email', 'pemail', { t: 'email', v: d.pemail, req: 1, chg: 'wizDup' })}${F('Profession', 'pjob', { v: d.pjob })}</div></form>`;
  }
  if (w.step === 2) {
    const stu = w.stu ? stuById(w.stu) : null;
    const bs = optBranches().filter((b) => S.branches.find((x) => x.id === b[0]).status === 'Operating');
    const br = d.branch || bs[0][0];
    const progs = S.programs.filter((p) => p.active && S.branches.find((b) => b.id === br).programs.includes(p.id));
    const prog = d.prog && progs.find((p) => p.id === d.prog) ? d.prog : progs[0].id;
    const fees = S.fees.filter((f) => f.active && f.prog === prog && f.branch === br);
    const f = fees.find((x) => x.pkg === d.pkg) || fees[0];
    const opp = w.opp && oppById(w.opp);
    const avail = S.discounts.filter(
      (x) =>
        x.active &&
        (x.branches === 'All' || (x.branches === 'UAE') === (S.branches.find((b) => b.id === br).country === 'UAE')),
    );
    const dsel = d.disc || (opp && opp.discount ? (opp.discount.kind === 'predefined' ? opp.discount.ref : 'EXC') : '');
    const opts = [['', 'No discount']]
      .concat(
        avail.map((x) => [x.id, 'Predefined: ' + x.name + ' (' + x.value + (x.type === '%' ? '%' : ' flat') + ')']),
      )
      .concat(
        opp && opp.discount && opp.discount.kind === 'exceptional'
          ? [
              [
                'EXC',
                'Approved exceptional discount ' +
                  opp.discount.value +
                  (opp.discount.type === '%' ? '%' : '') +
                  ' (' +
                  opp.discount.ref +
                  ')',
              ],
            ]
          : [],
      );
    const disc = !dsel
      ? null
      : dsel === 'EXC'
        ? opp.discount
        : (() => {
            const x = S.discounts.find((y) => y.id === dsel);
            return { kind: 'predefined', ref: x.id, name: x.name, type: x.type, value: x.value };
          })();
    body = `<form id="wf2" data-submit="wizStep2"><div class="fgrid">${F('Branch', 'branch', { v: br, opts: bs, chg: 'wizFee' })}${F('Programme', 'prog', { v: prog, opts: progs.map((p) => [p.id, p.name]), chg: 'wizFee' })}${F('Package', 'pkg', { v: f ? f.pkg : '', opts: fees.map((x) => [x.pkg, x.pkg + ' – ' + money(x.amt, x.cur)]), chg: 'wizFee' })}${F('Discount', 'disc', { v: dsel, opts, chg: 'wizFee' })}${F('Payment term', 'term', { v: wizTerm(d), opts: S.cfg.payTerms.filter((t) => t.active).map((t) => [t.id, t.name + ' (' + t.split.join('/') + ')']), chg: 'wizFee' })}</div></form>${opp && opp.discReq ? `<div class="banner" style="margin-top:12px">Exceptional discount ${opp.discReq} is still pending approval and cannot be applied.</div>` : ''}<div style="margin-top:14px">${f ? feeBox(f, disc, w.mode === 'new') : emptyBox('No active fee record', 'Add pricing under Fees & Pricing.')}</div>${f ? `<div class="sec">Payment schedule – ${esc(termName(wizTerm(d)))}</div>` + schedTable(buildSched(termById(wizTerm(d)), calcFee(f, disc, w.mode === 'new').total, TODAY), f.cur) : ''}<p class="muted sm">${w.mode === 'new' ? 'Student ID will be generated on enrolment: <b class="mono">LOF-26-' + String(S.seq.student).padStart(6, '0') + '</b> (permanent, non-editable).' : 'Existing Student ID <b class="mono">' + (stu ? stu.id : '—') + '</b> is reused.'}</p>`;
    w.calc = { f, disc, prog, br, term: wizTerm(d) };
  }
  if (w.step === 3) {
    const f = w.fee,
      c = calcFee(f, w.disc, w.mode === 'new'),
      sch = buildSched(termById(w.term), c.total, TODAY);
    body = `<div class="grid g2"><div>${feeBox(f, w.disc, w.mode === 'new')}</div><div><form id="wf3" data-submit="wizFinish"><div class="fgrid">${F('Amount paid now (' + f.cur + ')', 'amt', { t: 'number', min: 0, step: '0.01', v: sch[0].amt, req: 1, help: 'First instalment: ' + money(sch[0].amt, f.cur) + '. Enter 0 to enrol now and pay later.' })}${F('Payment method', 'method', { opts: S.cfg.pm, v: 'Card' })}${F('Payment reference', 'ref', { help: 'Required for non-cash methods.' })}</div></form><div class="banner" style="margin-top:12px">${ic('alert')}Payment gateway is not connected. The payment is recorded manually and marked simulated.</div></div></div><div class="card" style="margin-top:14px"><div class="hd"><h3>Payment schedule – ${esc(termName(w.term))}</h3></div><div class="bd">${schedTable(sch, f.cur)}</div></div><div class="card" style="margin-top:14px"><div class="bd">${dl(
      [
        [
          'Student',
          w.mode === 'new'
            ? esc(w.d.first + ' ' + w.d.last) + ' (new)'
            : esc(stuById(w.stu).first + ' ' + stuById(w.stu).last) + ' (' + w.stu + ')',
        ],
        ['Programme', esc(PNAME(w.calc.prog)) + ' · ' + esc(f.pkg)],
        ['Branch', esc(branchName(w.calc.br))],
        ['LMS', lmsEnrolmentSummary({ prog: w.calc.prog, pkg: f.pkg, date: TODAY })],
      ],
    )}</div></div>`;
  }
  const nav = `<div class="row" style="margin-top:16px;justify-content:space-between"><span>${w.step > 1 ? `<button class="btn" data-act="wizBack">Back</button>` : ''}</span><span class="row"><button class="btn ghost" data-act="wizCancel">Cancel</button><button class="btn primary" data-act="wizNext">${w.step === 3 ? 'Complete enrolment' : 'Continue'}</button></span></div>`;
  return (
    ph(w.mode === 'new' ? 'New Student Registration' : 'Existing Student Enrolment', flow) +
    `<div class="seg" style="margin-bottom:14px"><a class="${w.mode === 'new' ? 'on' : ''}" data-act="wizMode" data-m="new" tabindex="0">New student</a><a class="${w.mode === 'existing' ? 'on' : ''}" data-act="wizMode" data-m="existing" tabindex="0">Existing student</a></div>` +
    steps +
    card('', body + nav)
  );
};
Object.assign(ACT, {
  wizMode(d) {
    S.wiz = { mode: d.m, step: 1, opp: S.wiz.opp, stu: null, d: Object.assign({}, S.wiz.d) };
    S.route.mode = d.m;
    render();
  },
  wizPick(d) {
    S.wiz.stu = d.id;
    const s = stuById(d.id);
    S.wiz.d.branch = S.wiz.d.branch || s.branch;
    render();
  },
  wizBack() {
    S.wiz.step--;
    render();
  },
  wizCancel() {
    S.wiz = null;
    S.wizQ = '';
    go('enrollments');
  },
  wizNext() {
    const w = S.wiz;
    if (w.step === 1) {
      if (w.mode === 'existing') {
        if (!w.stu) {
          toast('Select an existing student first', 'warn');
          return;
        }
        w.step = 2;
        render();
      } else $('#wf1').requestSubmit();
    } else if (w.step === 2) {
      $('#wf2').requestSubmit();
    } else $('#wf3').requestSubmit();
  },
});
INP.wsq = (el) => {
  S.wizQ = el.value;
  render();
};
CHG.wizOpp = (el) => {
  const w = S.wiz;
  w.opp = el.value || null;
  if (w.opp) {
    const o = oppById(w.opp),
      l = leadById(o.lead),
      nm = o.student.split(' ');
    Object.assign(w.d, {
      first: nm[0],
      last: nm.slice(1).join(' '),
      dob: l.dob,
      school: l.school,
      grade: l.grade,
      curr: l.curr,
      pname: l.parent,
      pmob: l.phone,
      pemail: l.email,
      branch: o.branch,
      prog: o.prog,
      pkg: o.pkg,
      disc: undefined,
    });
  }
  render();
};
CHG.wizDup = (el) => {
  const f = el.form,
    values = fd(f),
    children = wizStudentMatches(values),
    parents = findDup(values.pmob, values.pemail).filter((x) => x.kind === 'Student'),
    matches = children.length ? children.map((s) => ({ id: s.id, name: s.first + ' ' + s.last })) : parents;
  $('#dupbox').innerHTML = matches.length
    ? `<div class="banner" style="display:block;${children.length ? 'background:var(--warn-bg)' : ''}"><b>${children.length ? 'Possible existing student.' : 'Parent contact already on file.'}</b> ${children.length ? 'The student email or full name and date of birth match a saved student. Use their existing profile if this is the same child. For a different child, verify the details and click Continue again.' : 'This parent phone or email is linked to the student(s) below. You can keep these parent details and continue registering a different child.'}${matches.map((x) => `<div class="row" style="margin-top:6px;color:var(--fg)"><span>${esc(x.name)} · <span class="mono">${x.id}</span></span><button type="button" class="btn sm" data-act="wizUse" data-id="${x.id}">Use existing student</button></div>`).join('')}</div>`
    : '';
};
ACT.wizUse = (d) => {
  S.wiz.mode = 'existing';
  S.wiz.stu = d.id;
  S.wizQ = d.id;
  S.route.mode = 'existing';
  render();
};
CHG.wizFee = (el) => {
  const f = $('#wf2'),
    d = S.wiz.d;
  ['branch', 'prog', 'pkg', 'disc', 'term'].forEach((k) => {
    d[k] = f.querySelector('[name=' + k + ']').value;
  });
  if (el.name === 'branch') {
    d.prog = undefined;
    d.pkg = undefined;
  }
  if (el.name === 'prog') {
    d.pkg = undefined;
  }
  render();
};
SUB.wizStep1 = (d, f) => {
  if (!need(f, d, ['first', 'last', 'dob', 'pname', 'pmob', 'pemail'])) return;
  if (!/^\S+@\S+\.\S+$/.test(d.pemail)) {
    setErr(f, 'pemail', 'Enter a valid e-mail address');
    return;
  }
  if (age(d.dob) < 3 || age(d.dob) > 21) {
    setErr(f, 'dob', 'Check the date of birth (age ' + age(d.dob) + ')');
    return;
  }
  Object.assign(S.wiz.d, d);
  const matches = wizStudentMatches(d);
  const matchKey = JSON.stringify([d.first, d.last, d.dob, d.semail, matches.map((s) => s.id)]);
  CHG.wizDup(f.querySelector('[name=pmob]'));
  if (matches.length && S.wiz.studentMatchAck !== matchKey) {
    S.wiz.studentMatchAck = matchKey;
    toast(
      'Possible existing student. Review the match above; use their profile or click Continue again for a different child.',
      'warn',
    );
    return;
  }
  S.wiz.step = 2;
  render();
};
SUB.wizStep2 = () => {
  const w = S.wiz,
    c = w.calc;
  if (!c.f) {
    toast('No active fee record for this selection', 'err');
    return;
  }
  const fl = $('#wf2');
  w.d.branch = c.br;
  w.d.prog = c.prog;
  w.d.pkg = c.f.pkg;
  w.fee = c.f;
  w.disc = c.disc;
  w.term = c.term;
  w.step = 3;
  render();
};
SUB.wizFinish = (d, f) => {
  const w = S.wiz,
    fee = w.fee;
  clearErrs(f);
  const amt = +d.amt || 0,
    tot = calcFee(fee, w.disc, w.mode === 'new').total;
  if (amt < 0 || amt > tot + 0.005) {
    setErr(f, 'amt', 'Amount must be between 0 and ' + money(tot, fee.cur));
    return;
  }
  if (amt > 0 && d.method !== 'Cash' && !String(d.ref).trim()) {
    setErr(f, 'ref', 'Reference is required for ' + d.method);
    return;
  }
  const dd = w.d,
    isNew = w.mode === 'new';
  let s;
  if (isNew) {
    s = {
      id: newStuId(),
      first: dd.first,
      last: dd.last,
      dob: dd.dob,
      gender: dd.gender || 'Female',
      nat: dd.nat || '—',
      school: dd.school || '—',
      grade: dd.grade || '—',
      curr: dd.curr || '—',
      address: dd.address || '—',
      email: dd.semail || '',
      mobile: dd.smob || '',
      fam: 'FAM-26-' + String(S.students.length + 1).padStart(4, '0'),
      branch: dd.branch,
      reg: TODAY,
      parents: [{ name: dd.pname, rel: dd.prel, email: dd.pemail, mobile: dd.pmob, job: dd.pjob || '—' }],
      moodle: null,
      interests: [PNAME(dd.prog)],
      status: 'Active',
      uni: '',
      degree: '',
      linkedin: '',
      portfolio: '',
      photoConsent: 'Not provided',
      consentDate: '',
      consentDoc: '',
      testimonials: [],
      docs: [{ n: 'Registration form', d: TODAY }],
      comm: [],
    };
    S.students.push(s);
  } else {
    s = stuById(w.stu);
    if (s.status !== 'Active') {
      s.status = 'Active';
    }
  }
  const prog = S.programs.find((p) => p.id === dd.prog),
    c = calcFee(fee, w.disc, isNew);
  const e = {
    id: 'EN-26-' + String(S.seq.enr++).padStart(4, '0'),
    stu: s.id,
    prog: dd.prog,
    branch: dd.branch,
    pkg: fee.pkg,
    date: TODAY,
    status: 'Active',
    cur: fee.cur,
    fee: c.base,
    reg: c.extra,
    disc: c.disc,
    discInfo: w.disc,
    tax: c.tax,
    total: c.total,
    taxPct: fee.tax,
    paid: 0,
    payStatus: 'Unpaid',
    opp: w.opp,
    course: prog.courses[0],
    sessions: fee.sessions,
    credits: prog.credits,
    newStu: isNew,
    term: w.term,
    sched: buildSched(termById(w.term), c.total, TODAY),
    cslr: w.opp && oppById(w.opp) ? oppById(w.opp).cslr : null,
  };
  S.enr.push(e);
  let pay = null;
  if (amt > 0) pay = addPay(S, e, amt, d.method, d.method === 'Cash' ? '—' : d.ref, nowIso(), me().id);
  const pcode = S.cfg.lms.programmes[e.prog] || {};
  const m = {
    id: 'MS-' + String(S.seq.ms++).padStart(3, '0'),
    enr: e.id,
    stu: s.id,
    op: 'enrol',
    status: e.payStatus === 'Paid' ? 'Pending' : 'Awaiting Payment',
    mid: null,
    cid: pcode.track || '—',
    credits: (pcode.credits || []).slice(),
    course: prog.name + ' · ' + e.pkg,
    mode: 'enrol',
    last: nowIso(),
    err: '',
    attempts: 0,
    hist: [{ at: nowIso(), s: 'Pending', msg: 'LMS purchase waits until full payment' }],
  };
  S.ms.push(m);
  e.ms = m.id;
  if (w.opp) {
    const o = oppById(w.opp);
    o.stage = 'Enrolled';
    o.stu = s.id;
    o.next = '';
    o.decision = 'Accepted';
    o.hist.push({ at: nowIso(), by: me().name, text: 'Enrolled – ' + s.id + ' / ' + e.id });
    addEv(leadById(o.lead), 'sys', 'Enrolled as ' + s.id + ' (' + e.id + ')');
  }
  const t4 = S.cfg.comms.find((t) => t.id === 'T4');
  if (t4 && t4.auto)
    s.comm.push({
      at: nowIso(),
      ch: 'Email',
      tpl: 'Enrolment welcome',
      text: msgFrom(
        t4.body,
        { parent: s.parents[0].name, student: s.first + ' ' + s.last, prog: e.prog, branch: e.branch, cslr: null },
        { sid: s.id },
      ),
      status: 'Sent (simulated)',
    });
  notify(
    'enr',
    'ok',
    'Enrolment completed: ' + s.first + ' ' + s.last + ' – ' + s.id + ' (' + prog.name + ')',
    { page: 'student', id: s.id },
    ['Centre Administrator', 'Admissions Head'],
    e.branch,
  );
  if (pay)
    notify(
      'pay',
      'ok',
      'Payment received (simulated): ' + money(amt, e.cur) + ' – ' + s.first + ' ' + s.last + ', ' + d.method,
      { page: 'payRecords' },
      ['Reception', 'Centre Administrator', 'Management'],
      e.branch,
    );
  if (t4 && t4.auto)
    notify(
      'mail',
      'ok',
      'Welcome email sent to ' + s.parents[0].name + ' (simulated)',
      { page: 'student', id: s.id },
      ['Centre Administrator'],
      e.branch,
    );
  addAudit(
    'Enrolment created',
    e.id,
    (isNew ? 'New student ' + s.id + ' registered; ' : 'Existing student ' + s.id + ' reused; ') + prog.name,
  );
  S.wiz = null;
  S.wizQ = '';
  go('student', { id: s.id });
  runSync(m.id);
  toast(
    (isNew ? 'Student ' + s.id + ' registered and ' : 'Additional programme ') +
      'enrolled. LMS purchase is sent after full payment.',
    'ok',
  );
};
