// ---------------- Students: edit personal details and parents / guardians
// Student ID, branch, family ID and registration date stay permanent (the server enforces it). Unknown values
// are stored as "—" like the rest of the student record and shown as empty boxes in the form.
var EMAIL_RE = /^\S+@\S+\.\S+$/,
  MOBILE_RE = /^\+?[\d\s()-]{7,20}$/;
var blankDash = function (v) {
  v = v == null ? '' : String(v);
  return v === '—' ? '' : v;
};
var dashBlank = function (v) {
  v = String(v == null ? '' : v).trim();
  return v || '—';
};
ACT.mStuEdit = function (d) {
  openModal('stuEdit', { id: d.id });
};
MODALS.stuEdit = function (m) {
  var s = stuById(m.id);
  return {
    title: 'Edit student ' + s.id,
    size: 'lg',
    form: 'stuEdit',
    ok: 'Save changes',
    body:
      '<input type="hidden" name="id" value="' +
      esc(s.id) +
      '"><div class="fgrid">' +
      F('First name', 'first', { v: s.first, req: 1 }) +
      F('Last name', 'last', { v: s.last, req: 1 }) +
      F('Date of birth', 'dob', { t: 'date', v: s.dob, req: 1, max: TODAY }) +
      F('Gender', 'gender', { v: s.gender, opts: ['Female', 'Male', 'Other'] }) +
      F('Nationality', 'nat', { v: blankDash(s.nat) }) +
      F('School', 'school', { v: blankDash(s.school) }) +
      F('Grade', 'grade', { v: blankDash(s.grade) }) +
      F('Curriculum', 'curr', { v: blankDash(s.curr), ph: 'e.g. CBSE, IB, British' }) +
      F('Student e-mail', 'email', { t: 'email', v: s.email || '', help: 'Optional' }) +
      F('Student mobile', 'mobile', { v: s.mobile || '', help: 'Optional' }) +
      F('Address', 'address', { t: 'textarea', v: blankDash(s.address), full: 1, rows: 2 }) +
      '<div class="f full"><p class="muted xs" style="margin:0">Student ID, branch, family ID and registration date cannot be changed.</p></div></div>',
  };
};
SUB.stuEdit = function (d, f) {
  if (!need(f, d, ['first', 'last', 'dob'])) return;
  if (d.dob > TODAY) {
    setErr(f, 'dob', 'Date of birth cannot be in the future');
    return;
  }
  if (d.email && !EMAIL_RE.test(d.email.trim())) {
    setErr(f, 'email', 'Enter a valid e-mail');
    return;
  }
  if (d.mobile && !MOBILE_RE.test(d.mobile.trim())) {
    setErr(f, 'mobile', 'Enter a valid mobile number');
    return;
  }
  var s = stuById(d.id),
    was = JSON.stringify(s),
    changed = [];
  var next = {
    first: d.first.trim(),
    last: d.last.trim(),
    dob: d.dob,
    gender: d.gender,
    nat: dashBlank(d.nat),
    school: dashBlank(d.school),
    grade: dashBlank(d.grade),
    curr: dashBlank(d.curr),
    address: dashBlank(d.address),
    email: (d.email || '').trim(),
    mobile: (d.mobile || '').trim(),
  };
  Object.keys(next).forEach(function (k) {
    if (String(s[k] == null ? '' : s[k]) !== String(next[k])) changed.push(k);
  });
  Object.assign(s, next);
  closeModal();
  if (JSON.stringify(s) === was) {
    toast('No changes', 'info');
    return;
  }
  addAudit('Student profile edited', s.id, 'Personal information: ' + changed.join(', '));
  render();
  toast('Student details saved', 'ok');
};
ACT.mParentEdit = function (d) {
  openModal('parentEdit', { id: d.id, i: +d.i });
};
MODALS.parentEdit = function (m) {
  var s = stuById(m.id),
    p = s.parents[m.i] || {};
  var rels = ['Father', 'Mother', 'Legal Guardian'].concat(
    p.rel && ['Father', 'Mother', 'Legal Guardian'].indexOf(p.rel) < 0 ? [p.rel] : [],
  );
  return {
    title: 'Edit parent / guardian',
    form: 'parentEdit',
    ok: 'Save',
    body:
      '<input type="hidden" name="id" value="' +
      esc(s.id) +
      '"><input type="hidden" name="i" value="' +
      m.i +
      '"><div class="fgrid">' +
      F('Name', 'name', { v: p.name, req: 1 }) +
      F('Relationship', 'rel', { v: p.rel, opts: rels }) +
      F('Mobile', 'mobile', { v: p.mobile, req: 1 }) +
      F('Email', 'email', {
        t: 'email',
        v: p.email,
        req: 1,
        help: m.i === 0 ? 'Main contact – receipts and LMS e-mails go here' : '',
      }) +
      F('Profession', 'job', { v: blankDash(p.job) }) +
      '</div>' +
      (s.parents.length > 1 && m.i > 0
        ? '<div class="row" style="margin-top:12px"><button class="btn sm danger" type="button" data-act="parentRemove" data-id="' +
          esc(s.id) +
          '" data-i="' +
          m.i +
          '">Remove this parent / guardian</button></div>'
        : ''),
  };
};
SUB.parentEdit = function (d, f) {
  if (!need(f, d, ['name', 'mobile', 'email'])) return;
  if (!EMAIL_RE.test(d.email.trim())) {
    setErr(f, 'email', 'Enter a valid e-mail');
    return;
  }
  if (!MOBILE_RE.test(d.mobile.trim())) {
    setErr(f, 'mobile', 'Enter a valid mobile number');
    return;
  }
  var s = stuById(d.id),
    p = s.parents[+d.i];
  if (!p) {
    closeModal();
    return;
  }
  Object.assign(p, {
    name: d.name.trim(),
    rel: d.rel,
    mobile: d.mobile.trim(),
    email: d.email.trim(),
    job: dashBlank(d.job),
  });
  addAudit('Parent edited', s.id, p.name + (+d.i === 0 ? ' (main contact)' : ''));
  closeModal();
  render();
  toast('Parent / guardian saved', 'ok');
};
ACT.parentRemove = function (d) {
  var s = stuById(d.id),
    i = +d.i;
  if (!s || i < 1 || s.parents.length < 2) return;
  var p = s.parents.splice(i, 1)[0];
  addAudit('Parent removed', s.id, p.name);
  closeModal();
  render();
  toast(p.name + ' removed', 'ok');
};
// Adding a parent: same checks as editing
var _parentSub = SUB.parent;
SUB.parent = function (d, f) {
  if (d.email && !EMAIL_RE.test(String(d.email).trim())) {
    clearErrs(f);
    setErr(f, 'email', 'Enter a valid e-mail');
    return;
  }
  if (d.mobile && !MOBILE_RE.test(String(d.mobile).trim())) {
    clearErrs(f);
    setErr(f, 'mobile', 'Enter a valid mobile number');
    return;
  }
  _parentSub(d, f);
  render();
};
