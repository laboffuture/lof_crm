/* New/edit lead, simulated capture, bulk assign and category. */
/* ====== forms for leads ====== */
function dupBox(d, canOverride) {
  if (!d.length) return '';
  return `<div class="banner" style="display:block;background:var(--crit-bg);color:var(--crit)"><b>Possible duplicate found</b> (matched on phone or e-mail)${d.map((x) => `<div class="row" style="margin-top:6px;color:var(--fg)">${bdg(x.kind, 'info')}<a ${x.go} data-close="1">${esc(x.name)}</a><span class="muted xs">${esc(x.id)} · ${esc(x.sub)}</span></div>`).join('')}<div style="margin-top:8px;color:var(--fg)">${canOverride ? `<label class="chk"><input type="checkbox" name="override" id="ovr"> I have reviewed the existing record(s) and need to create another lead</label>` : '<span class="sm">Your role cannot create duplicates – open the existing record instead.</span>'}</div></div>`;
}
const canOverride = () => !['Counsellor', 'Reception'].includes(me().role);
MODALS.leadForm = (m) => {
  const l = m.id ? leadById(m.id) : null;
  const v = l || { enq: nowIso(), cat: 'Warm', wa: true, em: true, branch: optBranches()[0][0], src: 'Manual' };
  const bs = optBranches();
  const srcs = S.cfg.sources;
  return {
    title: l ? 'Edit lead ' + l.id : 'New lead',
    size: 'lg',
    form: 'leadForm',
    ok: l ? 'Save changes' : 'Create lead',
    body: `<input type="hidden" name="id" value="${l ? l.id : ''}"><div id="dupbox"></div><div class="fgrid">
   <div class="sec">Prospect & parent</div>${F('Student / prospect name', 'student', { v: v.student, req: 1 })}${F('Date of birth', 'dob', { t: 'date', v: v.dob, help: 'Age is calculated from date of birth where available.' })}${F('Parent / guardian name', 'parent', { v: v.parent, req: 1 })}${F('Mobile number', 'phone', { v: v.phone, req: 1, ph: '+971 50 000 0000', chg: 'dup' })}${F('Email', 'email', { t: 'email', v: v.email, chg: 'dup' })}
   <div class="sec">School background</div>${F('School', 'school', { v: v.school })}${F('Grade', 'grade', { v: v.grade, ph: 'e.g. Grade 6' })}${F('Curriculum / board', 'curr', { v: v.curr, ph: 'British, CBSE, IB…' })}
   <div class="sec">Enquiry</div>${F('Branch preference', 'branch', { v: v.branch, req: 1, opts: bs, chg: 'leadBranch' })}${F('Programme / course interest', 'prog', { v: v.prog, req: 1, opts: optProgs(), blank: 'Select programme' })}${F('Lead source', 'src', { v: v.src, req: 1, opts: srcs.map((s) => [s.n, s.n + (s.en ? '' : ' (disabled)')]) })}${F('Campaign', 'camp', { v: v.camp, opts: S.cfg.camps.filter((c) => c.active).map((c) => c.n), blank: 'No campaign' })}${F('Enquiry date / time', 'enq', { t: 'datetime-local', v: locVal(v.enq), dis: !!l })}${F('Lead category', 'cat', { v: v.cat, opts: CATS.slice(0, 3) })}
   ${F('Assigned counsellor', 'cslr', { v: l ? l.cslr || '' : 'auto', opts: (l ? [['', 'Unassigned']] : [['auto', 'Auto – use routing rules']]).concat(optCslr(v.branch)), id: 'f_cslr', help: l ? 'Use Reassign on the lead page to keep assignment history.' : 'Routing considers branch, programme, availability and weighted workload.', dis: !!l })}
   <div class="sec">Communication consent</div><div class="f full">${CK('WhatsApp communication consent', 'wa', v.wa)}${CK('Email communication consent', 'em', v.em)}<div class="help">Automated messages are only sent where the matching consent is recorded.</div></div>
   ${S.cfg.fields.length ? `<div class="sec">Custom CRM fields</div>${S.cfg.fields.map((f, i) => (f.t === 'Dropdown' ? F(f.n, 'cf' + i, { v: (v.custom || {})[f.n] || '', opts: f.opts.split(',').map((x) => x.trim()), blank: 'Select', req: f.req }) : F(f.n, 'cf' + i, { v: (v.custom || {})[f.n] || '', req: f.req }))).join('')}` : ''}
   ${F('Internal notes', 'notes', { t: 'textarea', v: v.notes, full: 1 })}</div>`,
  };
};
CHG.leadBranch = (el) => {
  const f = el.form,
    c = f.querySelector('[name=cslr]');
  if (c && !c.disabled) {
    const cur = c.value;
    c.innerHTML =
      '<option value="auto">Auto – use routing rules</option>' +
      optCslr(el.value)
        .map((o) => `<option value="${o[0]}">${esc(o[1])}</option>`)
        .join('');
    c.value = cur === 'auto' ? 'auto' : 'auto';
  }
};
CHG.dup = (el) => {
  const f = el.form;
  if (f.querySelector('[name=id]').value) return;
  const d = findDup(f.querySelector('[name=phone]').value, f.querySelector('[name=email]').value);
  f._dups = d;
  $('#dupbox').innerHTML = dupBox(d, canOverride());
};
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-close]');
  if (a) {
    setTimeout(() => {
      if (S) {
        S.modal = null;
        render();
      }
    }, 0);
  }
});
SUB.leadForm = (d, form) => {
  const edit = !!d.id;
  const req = ['student', 'parent', 'phone', 'branch', 'prog', 'src'];
  if (!need(form, d, req)) return;
  if (!d.phone.replace(/\D/g, '').match(/^\d{7,15}$/)) {
    setErr(form, 'phone', 'Enter a valid mobile number');
    return;
  }
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) {
    setErr(form, 'email', 'Enter a valid e-mail address');
    return;
  }
  const br = S.branches.find((b) => b.id === d.branch);
  if (!br.programs.includes(d.prog)) {
    setErr(form, 'prog', PNAME(d.prog) + ' is not offered at ' + br.name);
    return;
  }
  const cust = {};
  S.cfg.fields.forEach((f, i) => {
    cust[f.n] = d['cf' + i] || '';
  });
  for (let i = 0; i < S.cfg.fields.length; i++) {
    const f = S.cfg.fields[i];
    if (f.req && !d['cf' + i]) {
      setErr(form, 'cf' + i, 'This field is required');
      return;
    }
  }
  if (edit) {
    const l = leadById(d.id),
      ch = [];
    [
      'student',
      'parent',
      'phone',
      'email',
      'school',
      'grade',
      'curr',
      'notes',
      'branch',
      'prog',
      'src',
      'camp',
    ].forEach((k) => {
      if (d[k] != null && String(l[k]) !== String(d[k])) {
        ch.push(k);
        l[k] = d[k];
      }
    });
    l.wa = !!d.wa;
    l.em = !!d.em;
    l.dob = d.dob;
    if (d.dob) l.age = age(d.dob);
    l.cat !== d.cat && changeCat(l, d.cat, '');
    l.custom = cust;
    addEv(l, 'sys', 'Lead details edited' + (ch.length ? ' (' + ch.join(', ') + ')' : ''));
    addAudit('Lead edited', l.id, ch.join(', ') || 'consents/fields');
    closeModal();
    toast('Lead updated', 'ok');
    return;
  }
  const src = S.cfg.sources.find((s) => s.n === d.src);
  if (!src.en) {
    setErr(form, 'src', 'Lead creation from ' + d.src + ' is disabled in configuration');
    return;
  }
  const dups = findDup(d.phone, d.email);
  if (dups.length) {
    $('#dupbox').innerHTML = dupBox(dups, canOverride());
    if (!d.override) {
      toast(
        canOverride()
          ? 'Review the possible duplicate, then confirm to continue'
          : 'Duplicate found – open the existing record',
        'warn',
      );
      return;
    }
  }
  d.enq = locIso(d.enq) || nowIso();
  d.wa = !!d.wa;
  d.em = !!d.em;
  const r = createLead(d);
  r.l.custom = cust;
  closeModal();
  if (r.rt && !r.rt.pick) {
    toast('Lead created but no counsellor is eligible – placed in Unassigned queue', 'warn');
  } else toast('Lead ' + r.l.id + ' created' + (r.l.cslr ? ' and assigned to ' + staffName(r.l.cslr) : ''), 'ok');
  go('lead', { id: r.l.id });
};
const NAMES = [
  ['Layan Haddad', 'Rima Haddad'],
  ['Kian Verma', 'Anita Verma'],
  ['Mariam Zaki', 'Yousef Zaki'],
  ['Reyansh Nair', 'Deepak Nair'],
  ['Noor Shaikh', 'Faisal Shaikh'],
  ['Ethan Dsouza', 'Gloria Dsouza'],
];
MODALS.simCapture = (m) => ({
  title: 'Simulate website / Meta lead capture',
  form: 'simCapture',
  ok: 'Capture lead',
  body: `<div class="banner">${ic('alert')}Simulation only – no website or Meta integration is connected. This creates a lead the way an enabled integration would, then applies the routing rules.</div><div class="fgrid">${F('Source', 'src', { opts: S.cfg.sources.filter((s) => s.n !== 'Manual').map((s) => [s.n, s.n + (s.en ? '' : ' (disabled)')]), v: 'Website' })}${F('Branch', 'branch', { opts: optBranches().filter((b) => S.branches.find((x) => x.id === b[0]).status === 'Operating'), v: optBranches()[0][0] })}${F('Programme', 'prog', { opts: optProgs(), v: 'ROB' })}${F('Category', 'cat', { opts: CATS.slice(0, 3), v: 'Hot' })}<div class="f full">${CK('WhatsApp consent given', 'wa', true)}${CK('Email consent given', 'em', true)}</div></div>`,
});
SUB.simCapture = (d, form) => {
  const s = S.cfg.sources.find((x) => x.n === d.src);
  if (!s.en) {
    setErr(form, 'src', 'Lead creation from ' + d.src + ' is disabled in Lead Sources');
    return;
  }
  const br = S.branches.find((b) => b.id === d.branch);
  if (!br.programs.includes(d.prog)) {
    setErr(form, 'prog', PNAME(d.prog) + ' is not offered at ' + br.name);
    return;
  }
  const n = NAMES[Math.floor(Math.random() * NAMES.length)];
  const camp = {
    Website: 'Website Organic',
    Facebook: 'Meta Lead Form – AI Coding',
    Instagram: 'Autumn STEM Open Day',
    WhatsApp: 'Walk-in / Referral',
  }[d.src];
  const r = createLead(
    {
      student: n[0],
      parent: n[1],
      phone: '+971 50 555 ' + (7000 + Math.floor(Math.random() * 999)),
      email: n[1].toLowerCase().replace(/ /g, '.') + '@example.com',
      branch: d.branch,
      prog: d.prog,
      src: d.src,
      camp,
      cat: d.cat,
      wa: !!d.wa,
      em: !!d.em,
      school: '',
      grade: '',
      curr: '',
      cslr: 'auto',
    },
    'Integration (simulated)',
  );
  openModal('routeResult', {
    id: r.l.id,
    rows: r.rt.rows.map((x) => ({
      n: x.s.name,
      b: x.s.branch,
      why: x.why,
      w: x.L.w,
      max: x.s.max,
      pick: r.rt.pick && r.rt.pick.id === x.s.id,
    })),
    pick: r.rt.pick && r.rt.pick.name,
  });
};
MODALS.routeResult = (m) => ({
  title: 'Lead captured and routed',
  size: 'lg',
  foot: `<button class="btn" data-act="closeModal">Close</button><button class="btn primary" data-act="go" data-page="lead" data-id="${m.id}">Open lead</button>`,
  body: `<p><b>${m.id}</b> was created. ${m.pick ? `Assigned to <b>${esc(m.pick)}</b> using <b>${esc(S.cfg.routing.method)}</b> routing.` : `<b>No counsellor is eligible.</b> The lead is in the Unassigned queue and the ${esc(S.cfg.routing.notifyNone)} has been notified.`}${S.cfg.comms.filter((t) => t.auto).length ? ' Automated WhatsApp/email were queued where consent exists (simulated).' : ''}</p>${table(
    'rr',
    [
      { h: 'Counsellor', f: (r) => esc(r.n) },
      { h: 'Branch', f: (r) => esc(r.b) },
      { h: 'Weighted load', f: (r) => r.w + ' / ' + r.max },
      {
        h: 'Eligibility',
        f: (r) => (r.pick ? bdg('Selected', 'ok') : r.why ? bdg(r.why, 'warn') : bdg('Eligible', 'info')),
      },
    ],
    m.rows,
    { all: 1 },
  )}`,
});
/* bulk */
MODALS.bulkAssign = (m) => {
  const ids = Object.keys(S_sel);
  return {
    title: 'Assign ' + ids.length + ' lead(s)',
    form: 'bulkAssign',
    ok: 'Assign',
    body: `<div class="fgrid">${F('Counsellor', 'to', { opts: optCslr(), blank: 'Select counsellor', req: 1 })}${F('Reason', 'reason', { req: 1, v: 'Manual assignment' })}</div><p class="muted sm">Each change is written to the lead’s assignment history. Manual assignment by a Centre Administrator needs no prior approval.</p>`,
  };
};
SUB.bulkAssign = (d, f) => {
  if (!need(f, d, ['to', 'reason'])) return;
  const ids = Object.keys(S_sel);
  ids.forEach((id) => {
    const l = leadById(id);
    if (l.status === 'Open') reassign(l, d.to, d.reason, 'Manual (bulk)');
  });
  S_sel = {};
  closeModal();
  toast(ids.length + ' lead(s) assigned to ' + staffName(d.to), 'ok');
};
MODALS.bulkCat = (m) => ({
  title: 'Change category for ' + Object.keys(S_sel).length + ' lead(s)',
  form: 'bulkCat',
  ok: 'Apply',
  body: `<div class="fgrid">${F('New category', 'cat', { opts: CATS, req: 1 })}${F('Reason (required for Not Interested)', 'reason', { opts: S.cfg.life.niReasons, blank: 'Select reason' })}</div>`,
});
SUB.bulkCat = (d, f) => {
  if (d.cat === 'Not Interested' && !d.reason) {
    clearErrs(f);
    setErr(f, 'reason', 'Reason is mandatory for Not Interested');
    return;
  }
  Object.keys(S_sel).forEach((id) => {
    const l = leadById(id);
    if (l.status === 'Open') changeCat(l, d.cat, d.reason);
  });
  S_sel = {};
  closeModal();
  toast('Category updated', 'ok');
};
ACT.openSimCapture = () => openModal('simCapture', {});
ACT.bulkAssign = () => openModal('bulkAssign', {});
ACT.bulkCat = () => openModal('bulkCat', {});
