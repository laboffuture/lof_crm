/* Programme master, fee structure, discounts and approval workflows. */
/* programmes */
CFG.programs = () =>
  card(
    'Programme master',
    table(
      'cp',
      [
        { h: 'Programme', f: (p) => `<b>${esc(p.name)}</b><div class="mono muted xs">${esc(p.code)}</div>` },
        { h: 'Category', f: (p) => esc(p.cat) },
        { h: 'Ages', f: (p) => p.ageMin + '–' + p.ageMax },
        { h: 'Branches', f: (p) => esc(p.branches.join(', ')) },
        { h: 'Duration · sessions · credits', f: (p) => esc(p.duration) + ' · ' + p.sessions + ' · ' + p.credits },
        { h: 'Courses (LMS ID)', f: (p) => esc(p.courses.map((c) => c.name + ' (' + c.moodleId + ')').join('; ')) },
        { h: 'Status', f: (p) => bdg(p.active ? 'Active' : 'Inactive', p.active ? 'ok' : '') },
        { h: '', f: (p) => `<button class="btn sm" data-act="mProg" data-id="${p.id}">Edit</button>` },
      ],
      S.programs,
      { ps: 10 },
    ),
    { np: 1, act: `<button class="btn sm primary" data-act="mProg">${ic('plus')} Add programme</button>` },
  ) +
  `<p class="muted xs">Sample records only – none of the programmes is hard-coded. Session count and credits flow to LMS at enrolment.</p>`;
ACT.mProg = (d) => openModal('prog', { id: d.id });
MODALS.prog = (m) => {
  const p = m.id
    ? S.programs.find((x) => x.id === m.id)
    : {
        id: '',
        name: '',
        code: '',
        cat: 'STEM',
        desc: '',
        ageMin: 8,
        ageMax: 16,
        branches: [],
        duration: '12 weeks',
        sessions: 24,
        credits: 3,
        active: true,
        options: ['Term (24 sessions)'],
        courses: [],
      };
  return {
    title: m.id ? 'Edit programme' : 'Add programme',
    size: 'lg',
    form: 'prog',
    ok: 'Save programme',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Programme name', 'name', { v: p.name, req: 1 })}${F('Unique programme code', 'code', { v: p.code, req: 1 })}${F('Short ID', 'id', { v: p.id, req: 1, dis: !!m.id })}${F('Category', 'cat', { v: p.cat })}${F('Eligible age from', 'ageMin', { t: 'number', v: p.ageMin })}${F('Eligible age to', 'ageMax', { t: 'number', v: p.ageMax })}${F('Duration', 'duration', { v: p.duration })}${F('Session count', 'sessions', { t: 'number', min: 1, v: p.sessions })}${F('Credits', 'credits', { t: 'number', min: 0, v: p.credits })}${F('Enrolment options (comma separated)', 'options', { v: p.options.join(', ') })}${F('Description', 'desc', { t: 'textarea', v: p.desc, full: 1 })}${F('Linked courses – one per line: name | LMS course ID', 'courses', { t: 'textarea', rows: 3, full: 1, v: p.courses.map((c) => c.name + ' | ' + c.moodleId).join('\n') })}<div class="f full"><label>Branch availability</label><div class="chips">${S.branches.map((b) => `<label class="chip" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="b_${b.id}"${p.branches.includes(b.id) ? ' checked' : ''}>${esc(b.name)}</label>`).join('')}</div></div>${CK('Active', 'active', p.active, { full: 1 })}</div>`,
  };
};
SUB.prog = (d, f) => {
  if (!need(f, d, ['name', 'code', 'id'])) return;
  const oid = d.oid;
  if (S.programs.find((p) => p.code === d.code && p.id !== (oid || d.id.toUpperCase()))) {
    setErr(f, 'code', 'Programme code already used');
    return;
  }
  if (!oid && S.programs.find((p) => p.id === d.id.toUpperCase())) {
    setErr(f, 'id', 'Short ID already exists');
    return;
  }
  if (+d.ageMin > +d.ageMax) {
    setErr(f, 'ageMax', 'Upper age must be above lower age');
    return;
  }
  const cs = [];
  for (const ln of d.courses.split('\n').filter((x) => x.trim())) {
    const [n, i] = ln.split('|').map((x) => x.trim());
    if (!n || !/^\d+$/.test(i || '')) {
      setErr(f, 'courses', 'Use the format “Course name | 4101” on each line');
      return;
    }
    cs.push({ name: n, moodleId: +i });
  }
  const o = {
    name: d.name,
    code: d.code,
    cat: d.cat,
    desc: d.desc,
    ageMin: +d.ageMin,
    ageMax: +d.ageMax,
    duration: d.duration,
    sessions: +d.sessions,
    credits: +d.credits,
    options: d.options
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    courses: cs,
    active: !!d.active,
    branches: S.branches.filter((b) => d['b_' + b.id]).map((b) => b.id),
  };
  if (oid)
    Object.assign(
      S.programs.find((p) => p.id === oid),
      o,
    );
  else S.programs.push(Object.assign({ id: d.id.toUpperCase() }, o));
  S.branches.forEach((b) => {
    const has = o.branches.includes(oid || d.id.toUpperCase()),
      pid = oid || d.id.toUpperCase();
    if (has && !b.programs.includes(pid) && o.branches.includes(b.id)) b.programs.push(pid);
    if (!o.branches.includes(b.id)) b.programs = b.programs.filter((x) => x !== pid);
  });
  S.branches.forEach((b) => {
    const pid = oid || d.id.toUpperCase();
    if (o.branches.includes(b.id) && !b.programs.includes(pid)) b.programs.push(pid);
  });
  closeModal();
  cfgSave('Programme ' + d.name, 'code ' + d.code);
};
/* fees */
CFG.fees = () => {
  const F2 = S.feeF || {};
  const fs = S.fees.filter((f) => (!F2.branch || f.branch === F2.branch) && (!F2.prog || f.prog === F2.prog));
  return (
    card(
      'Fee master',
      `<div class="tb"><select name="branch" data-change="feeF" aria-label="Branch"><option value="">All branches</option>${S.branches.map((b) => `<option value="${b.id}"${F2.branch === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select><select name="prog" data-change="feeF" aria-label="Programme"><option value="">All programmes</option>${S.programs.map((p) => `<option value="${p.id}"${F2.prog === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
        table(
          'cf',
          [
            { h: 'Fee', f: (f) => `<span class="mono">${f.id}</span>`, s: (f) => f.id },
            { h: 'Programme', f: (f) => esc(PNAME(f.prog)), s: (f) => f.prog },
            { h: 'Branch', f: (f) => esc(branchName(f.branch)), s: (f) => f.branch },
            { h: 'Package', f: (f) => esc(f.pkg) },
            { h: 'Sessions', f: (f) => f.sessions, r: 1 },
            { h: 'Fee', f: (f) => money(f.amt, f.cur), r: 1 },
            { h: 'Tax', f: (f) => f.tax + '%', r: 1 },
            { h: 'Registration', f: (f) => money(f.extra.amt, f.cur), r: 1 },
            { h: 'Effective', f: (f) => fD(f.from) + (f.to ? ' – ' + fD(f.to) : ' →') },
            {
              h: 'Status',
              f: (f) =>
                bdg(
                  f.active && f.from <= TODAY && (!f.to || f.to >= TODAY)
                    ? 'Active'
                    : f.active
                      ? 'Scheduled / ended'
                      : 'Inactive',
                  f.active && (!f.to || f.to >= TODAY) ? 'ok' : '',
                ),
            },
            { h: '', f: (f) => `<button class="btn sm" data-act="mFee" data-id="${f.id}">Edit</button>` },
          ],
          fs,
          { ps: 10 },
        ),
      { np: 1, act: `<button class="btn sm primary" data-act="mFee">${ic('plus')} Add fee</button>` },
    ) +
    `<p class="muted xs">Changing a fee amount, tax or registration charge ends the current record yesterday and creates a new one effective today, so completed enrolments and payments are never rewritten. Tax treatment needs business confirmation.</p>`
  );
};
CHG.feeF = (el) => {
  S.feeF = S.feeF || {};
  S.feeF[el.name] = el.value;
  S.tbl.cf && (S.tbl.cf.page = 1);
  render();
};
ACT.mFee = (d) => openModal('fee', { id: d.id });
MODALS.fee = (m) => {
  const f = m.id
    ? S.fees.find((x) => x.id === m.id)
    : {
        prog: 'ROB',
        branch: 'KRM',
        pkg: 'Term (24 sessions)',
        sessions: 24,
        amt: 0,
        tax: 5,
        extra: { name: 'Registration fee (new students)', amt: 0 },
        from: TODAY,
        to: '',
        active: true,
      };
  return {
    title: m.id ? 'Edit fee ' + f.id : 'Add fee',
    size: 'lg',
    form: 'fee',
    ok: 'Save fee',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Programme', 'prog', { v: f.prog, opts: S.programs.map((p) => [p.id, p.name]), dis: !!m.id })}${F('Branch', 'branch', { v: f.branch, opts: S.branches.map((b) => [b.id, b.name]), dis: !!m.id, help: 'Currency follows the branch' })}${F('Package / enrolment type', 'pkg', { v: f.pkg, req: 1 })}${F('Session count', 'sessions', { t: 'number', min: 1, v: f.sessions })}${F('Fee amount', 'amt', { t: 'number', min: 0, step: '0.01', v: f.amt, req: 1 })}${F('Tax %', 'tax', { t: 'number', min: 0, step: '0.01', v: f.tax })}${F('Additional charge – registration', 'reg', { t: 'number', min: 0, step: '0.01', v: f.extra.amt })}${F('Effective from', 'from', { t: 'date', v: f.from, req: 1 })}${F('Effective to (optional)', 'to', { t: 'date', v: f.to })}${CK('Active', 'active', f.active, { full: 1 })}</div>`,
  };
};
SUB.fee = (d, f) => {
  if (!need(f, d, ['pkg', 'amt', 'from'])) return;
  if (!(+d.amt > 0)) {
    setErr(f, 'amt', 'Enter an amount above zero');
    return;
  }
  if (d.to && d.to < d.from) {
    setErr(f, 'to', 'End date is before start date');
    return;
  }
  if (d.oid) {
    const o = S.fees.find((x) => x.id === d.oid);
    const money = +d.amt !== o.amt || +d.tax !== o.tax || +d.reg !== o.extra.amt;
    if (money && o.from <= TODAY) {
      const y = dayKey(dAt(-1, 12));
      o.to = y;
      const n = Object.assign({}, o, {
        id: 'FEE-' + String(S.fees.length + 1).padStart(3, '0'),
        amt: +d.amt,
        tax: +d.tax,
        extra: { name: o.extra.name, amt: +d.reg },
        from: TODAY,
        to: d.to || '',
        pkg: d.pkg,
        sessions: +d.sessions,
        active: !!d.active,
      });
      S.fees.push(n);
      closeModal();
      cfgSave('Fee ' + o.id, 'versioned: new record ' + n.id + ' effective today; ' + o.id + ' ended ' + y);
      return;
    }
    Object.assign(o, { pkg: d.pkg, sessions: +d.sessions, from: d.from, to: d.to, active: !!d.active });
    closeModal();
    cfgSave('Fee ' + o.id, 'updated');
  } else {
    if (S.fees.find((x) => x.prog === d.prog && x.branch === d.branch && x.pkg === d.pkg && x.active && !x.to)) {
      setErr(f, 'pkg', 'An active fee already exists for this programme, branch and package');
      return;
    }
    const b = S.branches.find((x) => x.id === d.branch);
    S.fees.push({
      id: 'FEE-' + String(S.fees.length + 1).padStart(3, '0'),
      prog: d.prog,
      branch: d.branch,
      pkg: d.pkg,
      sessions: +d.sessions,
      cur: b.cur,
      amt: +d.amt,
      tax: +d.tax,
      extra: { name: 'Registration fee (new students)', amt: +d.reg },
      from: d.from,
      to: d.to,
      active: !!d.active,
    });
    closeModal();
    cfgSave('Fee added', PNAME(d.prog) + ' · ' + b.name);
  }
};
/* discounts */
CFG.discounts = () => {
  const ex = S.cfg.wf.find((w) => w.t === 'Exceptional discount');
  return (
    card(
      'Predefined discounts',
      table(
        'cd',
        [
          { h: 'Code', f: (d) => d.id },
          { h: 'Name', f: (d) => `<b>${esc(d.name)}</b>` },
          { h: 'Value', f: (d) => (d.type === '%' ? d.value + '%' : 'Flat ' + d.value) },
          { h: 'Eligibility / applicability rule', f: (d) => esc(d.elig) },
          { h: 'Applies to', f: (d) => d.branches },
          { h: 'Status', f: (d) => bdg(d.active ? 'Active' : 'Inactive', d.active ? 'ok' : '') },
          { h: '', f: (d) => `<button class="btn sm" data-act="mDiscCfg" data-id="${d.id}">Edit</button>` },
        ],
        S.discounts,
        { all: 1 },
      ),
      {
        np: 1,
        act: `<button class="btn sm primary" data-act="mDiscCfg">${ic('plus')} Add predefined discount</button>`,
      },
    ) +
    `<p class="muted xs">Only System Administrators can create or change predefined discounts. They need no approval when applied (latest clarification).</p><div style="height:14px"></div>` +
    card(
      'Exceptional discounts',
      cfgForm(
        'exc',
        `<div class="fgrid">${F('Approver role', 'ap', { v: ex.ap, opts: ROLES })}${F('Approval rule', 'scope', { v: ex.scope })}</div><p class="muted sm">Every exceptional discount is routed to this approver and is not applied until approved. No slabs or limits are hard-coded; value limits can be added here once the business confirms them.</p>`,
      ),
    )
  );
};
SUB.cfg_exc = (d, f) => {
  const ex = S.cfg.wf.find((w) => w.t === 'Exceptional discount');
  ex.ap = d.ap;
  ex.scope = d.scope;
  cfgSave('Exceptional discount approval', 'approver ' + d.ap);
};
ACT.mDiscCfg = (d) => openModal('discCfg', { id: d.id });
MODALS.discCfg = (m) => {
  const x = m.id
    ? S.discounts.find((y) => y.id === m.id)
    : { name: '', type: '%', value: 0, elig: '', branches: 'All', active: true };
  return {
    title: m.id ? 'Edit predefined discount' : 'Add predefined discount',
    form: 'discCfg',
    ok: 'Save',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Name', 'name', { v: x.name, req: 1 })}${F(
      'Type',
      'type',
      {
        v: x.type,
        opts: [
          ['%', 'Percentage'],
          ['flat', 'Flat amount'],
        ],
      },
    )}${F('Value', 'value', { t: 'number', min: 0, step: '0.01', v: x.value, req: 1 })}${F('Applies to', 'branches', { v: x.branches, opts: ['All', 'UAE', 'India'] })}${F('Eligibility / applicability rule', 'elig', { v: x.elig, t: 'textarea', full: 1, req: 1 })}${CK('Active', 'active', x.active, { full: 1 })}</div>`,
  };
};
SUB.discCfg = (d, f) => {
  if (!need(f, d, ['name', 'value', 'elig'])) return;
  if (!(+d.value > 0) || (d.type === '%' && +d.value > 100)) {
    setErr(f, 'value', 'Enter a valid value');
    return;
  }
  const o = { name: d.name, type: d.type, value: +d.value, elig: d.elig, branches: d.branches, active: !!d.active };
  if (d.oid)
    Object.assign(
      S.discounts.find((x) => x.id === d.oid),
      o,
    );
  else S.discounts.push(Object.assign({ id: 'PD-' + String(S.seq.pd++).padStart(2, '0') }, o));
  closeModal();
  cfgSave('Predefined discount ' + d.name, d.value + (d.type === '%' ? '%' : ' flat'));
};
/* workflows */
CFG.workflows = () =>
  card(
    'Approval workflows',
    cfgForm(
      'wf',
      `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Request</th><th>Approval required</th><th>Approver</th><th>Scope</th><th>Status of rule</th></tr></thead><tbody>${S.cfg.wf
        .map(
          (w, i) =>
            `<tr><td><b>${esc(w.t)}</b></td><td>${SW('req' + i, w.req)}</td><td><select name="ap${i}" aria-label="Approver">${[
              '—',
            ]
              .concat(ROLES)
              .map((r) => `<option${w.ap === r ? ' selected' : ''}>${r}</option>`)
              .join(
                '',
              )}</select></td><td class="sm">${esc(w.scope)}</td><td>${bdg(w.note, w.note.startsWith('Needs') ? 'warn' : 'ok')}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><p class="muted xs">Not every request goes through the same flow. Approval history is recorded for every decision.</p>`,
    ),
  );
SUB.cfg_wf = (d) => {
  S.cfg.wf.forEach((w, i) => {
    w.req = !!d['req' + i];
    w.ap = d['ap' + i];
  });
  cfgSave('Approval workflows', 'updated approvers');
};
