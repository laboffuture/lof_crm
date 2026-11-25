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
// The fee master must display the same current price as registration, regardless of load order.
function currentFeeRows(fees) {
  const groups = new Map();
  fees.forEach((f) => {
    const key = JSON.stringify([f.branch, f.prog, f.pkg]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });
  return [...groups.values()]
    .map((versions) => {
      const f = versions[0];
      const current = feeFor({ fees: versions }, f.prog, f.branch, f.pkg);
      if (current) return current;
      // Keep scheduled and inactive-only packages manageable when no price applies today.
      const scheduled = versions.filter((v) => v.active && v.from > TODAY);
      const candidates = scheduled.length ? scheduled : versions;
      return candidates
        .slice()
        .sort(
          (a, b) =>
            (scheduled.length
              ? String(a.from).localeCompare(String(b.from))
              : String(b.from).localeCompare(String(a.from))) ||
            String(b.revisionAt || '').localeCompare(String(a.revisionAt || '')) ||
            String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
        )[0];
    })
    .sort(
      (a, b) =>
        String(a.branch).localeCompare(String(b.branch)) ||
        String(a.prog).localeCompare(String(b.prog)) ||
        String(a.pkg).localeCompare(String(b.pkg)),
    );
}
CFG.fees = () => {
  const F2 = S.feeF || {};
  const filtered = S.fees.filter((f) => (!F2.branch || f.branch === F2.branch) && (!F2.prog || f.prog === F2.prog));
  const fs = F2.view === 'all' ? filtered : currentFeeRows(filtered);
  const applied = (f) => feeFor(S, f.prog, f.branch, f.pkg);
  return (
    card(
      'Fee master',
      `<div class="tb"><select name="branch" data-change="feeF" aria-label="Branch"><option value="">All branches</option>${S.branches.map((b) => `<option value="${b.id}"${F2.branch === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select><select name="prog" data-change="feeF" aria-label="Programme"><option value="">All programmes</option>${S.programs.map((p) => `<option value="${p.id}"${F2.prog === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select><select name="view" data-change="feeF" aria-label="Fee versions"><option value="current"${F2.view !== 'all' ? ' selected' : ''}>Current fees</option><option value="all"${F2.view === 'all' ? ' selected' : ''}>All fee versions</option></select></div>` +
        table(
          'cf',
          [
            { h: 'Fee', f: (f) => `<span class="mono">${f.id}</span>`, s: (f) => f.id },
            { h: 'Programme', f: (f) => esc(PNAME(f.prog)), s: (f) => f.prog },
            { h: 'Branch', f: (f) => esc(branchName(f.branch)), s: (f) => f.branch },
            { h: 'Package', f: (f) => esc(f.pkg) },
            { h: 'Sessions', f: (f) => f.sessions, r: 1 },
            { h: 'Fee', f: (f) => money(f.amt, f.cur), r: 1 },
            { h: 'Course ID', f: (f) => esc(f.courseId || '—') },
            { h: 'Tax', f: (f) => esc(window.feeTaxLabel?.(f) || f.tax + '%'), r: 1 },
            { h: 'Registration', f: (f) => money(f.extra.amt, f.cur), r: 1 },
            { h: 'Effective', f: (f) => fD(f.from) + (f.to ? ' – ' + fD(f.to) : ' →') },
            {
              h: 'Status',
              f: (f) =>
                bdg(
                  applied(f) && applied(f).id !== f.id && f.from <= TODAY
                    ? 'Previous version'
                    : f.active && f.from <= TODAY && (!f.to || f.to >= TODAY)
                      ? 'Active'
                      : f.active
                        ? 'Scheduled / ended'
                        : 'Inactive',
                  f.active && (!f.to || f.to >= TODAY) ? 'ok' : '',
                ),
            },
            {
              h: '',
              f: (f) => {
                const current = applied(f);
                const previous = current && current.id !== f.id && f.from <= TODAY;
                return `<button class="btn sm" data-act="mFee" data-id="${previous ? current.id : f.id}">${previous ? 'Edit current fee' : 'Edit'}</button>`;
              },
            },
          ],
          fs,
          { ps: 10 },
        ),
      { np: 1, act: `<button class="btn sm primary" data-act="mFee">${ic('plus')} Add fee</button>` },
    ) +
    `<p class="muted xs">Current fees shows one price per programme, branch and package. Choose All fee versions to review previous or scheduled prices. Editing a used fee saves a new version; existing enrolments keep their original amounts.</p>`
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
  if (!f) return { title: 'Fee unavailable', body: 'This fee is no longer available.' };
  const used = !!m.id && S.enr.some((e) => e.feeId === m.id);
  const branch = S.branches.find((b) => b.id === f.branch);
  return {
    title: m.id ? 'Edit fee ' + f.id : 'Add fee',
    size: 'lg',
    form: 'fee',
    ok: 'Save fee',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Programme', 'prog', { v: f.prog, opts: S.programs.map((p) => [p.id, p.name]), dis: used })}${F('Branch', 'branch', { v: f.branch, opts: S.branches.map((b) => [b.id, b.name]), dis: used, chg: 'feeBranch', help: 'Currency follows the branch' })}${F('Course ID', 'courseId', { v: f.courseId, req: !m.id, max: 80 })}${F('Package / enrolment type', 'pkg', { v: f.pkg, req: 1 })}${F('Session count', 'sessions', { t: 'number', min: 1, v: f.sessions })}${F('Fee amount', 'amt', { t: 'number', min: 0, step: '0.01', v: f.amt, req: 1 })}${'<div data-fee-tax>' + feeTaxFields(branch, f.tax) + '</div>'}${F('Additional charge – registration', 'reg', { t: 'number', min: 0, step: '0.01', v: f.extra.amt })}${F('Effective from', 'from', { t: 'date', v: f.from, req: 1 })}${F('Effective to (optional)', 'to', { t: 'date', v: f.to })}${CK('Active', 'active', f.active, { full: 1 })}</div><p class="muted xs">For a fee used by an enrolment, a price change creates a new version effective today or later. An expired end date is cleared for the new version.</p><p data-fee-error role="alert" class="fe" hidden></p>`,
  };
};
// Keep edits out of shared state until the live server confirms the whole fee transaction.
function feeTaxFields(branch, fallback) {
  const india = branch?.cur === 'INR' || /^ind/i.test(branch?.country || '');
  if (!india) return F('VAT %', 'tax', { t: 'number', min: 0, step: '0.01', v: fallback });
  const configured = window.feeTaxPct?.({ branch: branch.id, tax: fallback }) ?? fallback;
  return (
    F('GST %', 'gstPreview', { v: configured + '%', dis: true, help: 'Set CGST and SGST in Settings → Branches' }) +
    '<input type="hidden" name="tax" value="' +
    esc(fallback) +
    '">'
  );
}
CHG.feeBranch = (el) => {
  const form = el.form;
  const target = form.querySelector('[data-fee-tax]');
  const previous = form.elements.tax?.value || 0;
  target.innerHTML = feeTaxFields(
    S.branches.find((b) => b.id === el.value),
    previous,
  );
};

const persistFee = (entries, form, what, detail, data) => {
  if (window.saveFeeChanges) return window.saveFeeChanges(entries, form, what, JSON.stringify(data));
  entries.forEach(({ doc }) => {
    const old = S.fees.find((x) => x.id === doc.id);
    if (old) Object.assign(old, doc);
    else S.fees.push(doc);
  });
  closeModal();
  cfgSave(what, detail);
};
SUB.fee = (d, f) => {
  if (f._feeSaving) return;
  if (!need(f, d, ['pkg', 'amt', 'from'])) return;
  const oldFee = d.oid && S.fees.find((row) => row.id === d.oid);
  if (d.oid && !oldFee) return;
  d.prog ||= oldFee?.prog;
  d.branch ||= oldFee?.branch;
  d.courseId = String(d.courseId || '').trim();
  if ((!oldFee && !d.courseId) || (d.courseId && !/^[^<>"'`\\\u0000-\u001f\u007f]{1,80}$/.test(d.courseId))) {
    setErr(f, 'courseId', 'Enter a valid course ID of up to 80 characters');
    return;
  }
  if (!(+d.amt > 0)) {
    setErr(f, 'amt', 'Enter an amount above zero');
    return;
  }
  if (!Number.isFinite(+d.tax) || +d.tax < 0) {
    setErr(f, 'tax', 'Enter a tax percentage of zero or more');
    return;
  }
  if (!Number.isFinite(+d.reg) || +d.reg < 0) {
    setErr(f, 'reg', 'Enter a registration charge of zero or more');
    return;
  }
  if (d.to && d.to < d.from) {
    setErr(f, 'to', 'End date is before start date');
    return;
  }
  if (d.oid) {
    const o = S.fees.find((x) => x.id === d.oid);
    const priceChanged = +d.amt !== o.amt || +d.tax !== o.tax || +d.reg !== o.extra.amt;
    const branch = S.branches.find((row) => row.id === d.branch);
    const used = (S.enr || []).some((e) => e.feeId === o.id);
    if (priceChanged && used) {
      const start = d.from > TODAY ? d.from : TODAY;
      const y = addDays(start, -1);
      const closed = Object.assign({}, o, { to: o.to && o.to < start ? o.to : y < o.from ? o.from : y });
      if (y < o.from) closed.active = false;
      const n = Object.assign({}, o, {
        id: 'FEE-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
        supersedes: o.id,
        courseId: d.courseId,
        amt: +d.amt,
        tax: +d.tax,
        extra: { name: o.extra.name, amt: +d.reg },
        from: start,
        to: d.to && d.to >= start ? d.to : '',
        pkg: d.pkg,
        sessions: +d.sessions,
        active: !!d.active,
      });
      return persistFee(
        [
          { coll: 'fees', id: o.id, op: 'upsert', base: o, doc: closed },
          { coll: 'fees', id: n.id, op: 'upsert', doc: n },
        ],
        f,
        'Fee ' + o.id,
        'versioned: new record ' + n.id + ' effective ' + start,
        d,
      );
    }
    const updated = Object.assign({}, o, {
      prog: d.prog,
      branch: d.branch,
      cur: branch.cur,
      courseId: d.courseId,
      pkg: d.pkg,
      sessions: +d.sessions,
      amt: +d.amt,
      tax: +d.tax,
      extra: { name: o.extra.name, amt: +d.reg },
      from: d.from,
      to: d.to,
      active: !!d.active,
    });
    return persistFee(
      [{ coll: 'fees', id: o.id, op: 'upsert', base: o, doc: updated }],
      f,
      'Fee ' + o.id,
      'updated',
      d,
    );
  } else {
    if (S.fees.find((x) => x.prog === d.prog && x.branch === d.branch && x.pkg === d.pkg && x.active && !x.to)) {
      setErr(f, 'pkg', 'An active fee already exists for this programme, branch and package');
      return;
    }
    const b = S.branches.find((x) => x.id === d.branch);
    const created = {
      id: 'FEE-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
      prog: d.prog,
      branch: d.branch,
      courseId: d.courseId,
      pkg: d.pkg,
      sessions: +d.sessions,
      cur: b.cur,
      amt: +d.amt,
      tax: +d.tax,
      extra: { name: 'Registration fee (new students)', amt: +d.reg },
      from: d.from,
      to: d.to,
      active: !!d.active,
    };
    return persistFee(
      [{ coll: 'fees', id: created.id, op: 'upsert', doc: created }],
      f,
      'Fee added',
      PNAME(d.prog) + ' · ' + b.name,
      d,
    );
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
