/* Branches, staff & users, roles and permission matrix. */
/* branches */
CFG.branches = () =>
  card(
    'Branch management',
    table(
      'cb',
      [
        { h: 'Branch', f: (b) => `<b>${esc(b.name)}</b><div class="mono muted xs">${esc(b.code)}</div>` },
        { h: 'Country · city', f: (b) => esc(b.country + ' · ' + b.city) },
        { h: 'Status', f: (b) => bdg(b.status, b.status === 'Operating' ? 'ok' : 'warn') },
        { h: 'Administrator', f: (b) => esc(staffName(b.admin)) },
        {
          h: 'Counsellors',
          f: (b) =>
            esc(
              S.staff
                .filter((s) => s.role === 'Counsellor' && s.branch === b.id)
                .map((s) => s.name)
                .join(', ') || '—',
            ),
        },
        { h: 'Programmes', f: (b) => b.programs.length },
        { h: 'Hours', f: (b) => esc(b.days + ' · ' + b.hours) },
        { h: 'Monthly target', f: (b) => (b.tAdm ? b.tAdm + ' admissions / ' + money(b.tRev, b.cur) : '—') },
        { h: '', f: (b) => `<button class="btn sm" data-act="mBranch" data-id="${b.id}">Edit</button>` },
      ],
      S.branches,
      { all: 1 },
    ),
    { np: 1, act: `<button class="btn sm primary" data-act="mBranch">${ic('plus')} Add branch</button>` },
  ) +
  `<p class="muted xs">Branch-specific fees are managed under Fees & Pricing; branch communication templates under Communication. Future locations in India, the UAE and elsewhere can be added here.</p>`;
ACT.mBranch = (d) => openModal('branch', { id: d.id });
MODALS.branch = (m) => {
  const b = m.id
    ? S.branches.find((x) => x.id === m.id)
    : {
        id: '',
        name: '',
        code: '',
        country: 'UAE',
        city: '',
        cur: 'AED',
        address: '',
        phone: '',
        email: '',
        status: 'Planned',
        admin: '',
        programs: [],
        days: 'Sun–Fri',
        hours: '09:00–19:00',
        tAdm: 0,
        tRev: 0,
      };
  return {
    title: m.id ? 'Edit branch' : 'Add branch',
    size: 'lg',
    form: 'branch',
    ok: 'Save branch',
    body: `<input type="hidden" name="oid" value="${esc(m.id || '')}"><div class="fgrid">${F('Branch name', 'name', { v: b.name, req: 1 })}${F('Unique branch code', 'code', { v: b.code, req: 1, ph: 'LOF-XXX-000' })}${F('Short ID', 'id', { v: b.id, req: 1, dis: !!m.id, help: '3–4 letters; cannot change later' })}${F('Country', 'country', { v: b.country, opts: ['UAE', 'India', 'Other'] })}${F('City / location', 'city', { v: b.city, req: 1 })}${F('Currency', 'cur', { v: b.cur, opts: ['AED', 'INR', 'USD'] })}${F('Operating status', 'status', { v: b.status, opts: ['Operating', 'Planned', 'Closed'] })}${F('Branch administrator', 'admin', { v: b.admin, opts: S.staff.filter((s) => s.role === 'Centre Administrator').map((s) => [s.id, s.name]), blank: 'Not assigned' })}${F('Address', 'address', { v: b.address, full: 1 })}${F('Phone', 'phone', { v: b.phone })}${F('Email', 'email', { v: b.email })}${F('Working days', 'days', { v: b.days })}${F('Operational hours', 'hours', { v: b.hours })}${F('Monthly admissions target', 'tAdm', { t: 'number', min: 0, v: b.tAdm })}${F('Monthly revenue target', 'tRev', { t: 'number', min: 0, v: b.tRev })}<div class="sec">Programmes offered</div><div class="f full"><div class="chips">${S.programs.map((p) => `<label class="chip" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="p_${p.id}"${b.programs.includes(p.id) ? ' checked' : ''}>${esc(p.name)}</label>`).join('')}</div></div></div>`,
  };
};
SUB.branch = (d, f) => {
  if (!need(f, d, ['name', 'code', 'id', 'city'])) return;
  const dup = S.branches.find((b) => b.code === d.code && b.id !== (d.oid || d.id));
  if (dup) {
    setErr(f, 'code', 'Branch code already used by ' + dup.name);
    return;
  }
  if (!d.oid && S.branches.find((b) => b.id === d.id.toUpperCase())) {
    setErr(f, 'id', 'Short ID already exists');
    return;
  }
  const progs = S.programs.filter((p) => d['p_' + p.id]).map((p) => p.id);
  const o = {
    id: (d.oid || d.id).toUpperCase(),
    name: d.name,
    code: d.code,
    country: d.country,
    city: d.city,
    cur: d.cur,
    address: d.address,
    phone: d.phone,
    email: d.email,
    status: d.status,
    admin: d.admin,
    programs: progs,
    days: d.days,
    hours: d.hours,
    tAdm: +d.tAdm || 0,
    tRev: +d.tRev || 0,
  };
  if (d.oid)
    Object.assign(
      S.branches.find((b) => b.id === d.oid),
      o,
    );
  else {
    S.branches.push(o);
    S.hist[o.id] = [0, 0, 0, 0, 0];
  }
  closeModal();
  cfgSave('Branch ' + o.name, 'code ' + o.code + ', status ' + o.status);
};
/* staff */
CFG.staff = () =>
  card(
    'Staff & user management',
    table(
      'cs',
      [
        { h: 'Name', f: (s) => `<b>${esc(s.name)}</b><div class="muted xs">${esc(s.emp)} · ${esc(s.email)}</div>` },
        { h: 'Role', f: (s) => esc(s.role) },
        { h: 'Branch · dept', f: (s) => esc(branchName(s.branch) + ' · ' + s.dept) },
        { h: 'Programmes handled', f: (s) => esc(s.programs.map(PNAME).join(', ') || '—') },
        { h: 'Employment', f: (s) => stB(s.status) },
        {
          h: 'Availability',
          f: (s) =>
            bdg(s.avail, s.avail === 'Available' ? 'ok' : 'warn') +
            (s.leave ? '<div class="muted xs">' + fD(s.leave.from) + ' – ' + fD(s.leave.to) + '</div>' : ''),
        },
        { h: 'Max load', f: (s) => (s.role === 'Counsellor' ? s.max : '—'), r: 1 },
        { h: 'Access', f: (s) => bdg(s.access, s.access === 'Enabled' ? 'ok' : 'crit') },
        { h: '', f: (s) => `<button class="btn sm" data-act="mStaff" data-id="${s.id}">Edit</button>` },
      ],
      S.staff,
      { ps: 10 },
    ),
    { np: 1, act: `<button class="btn sm primary" data-act="mStaff">${ic('plus')} Add staff</button>` },
  );
ACT.mStaff = (d) => openModal('staff', { id: d.id });
MODALS.staff = (m) => {
  const s = m.id
    ? S.staff.find((x) => x.id === m.id)
    : {
        id: '',
        name: '',
        emp: '',
        email: '',
        mobile: '',
        branch: 'KRM',
        dept: 'Admissions',
        role: 'Counsellor',
        programs: [],
        status: 'Active',
        access: 'Enabled',
        avail: 'Available',
        max: 12,
        leave: null,
        backup: '',
      };
  return {
    title: m.id ? 'Edit staff – ' + s.name : 'Add staff',
    size: 'lg',
    form: 'staff',
    ok: 'Save staff',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Full name', 'name', { v: s.name, req: 1 })}${F('Employee ID', 'emp', { v: s.emp, req: 1 })}${F('Email', 'email', { t: 'email', v: s.email, req: 1 })}${F('Mobile', 'mobile', { v: s.mobile })}${F('Branch', 'branch', { v: s.branch, opts: S.branches.map((b) => [b.id, b.name]) })}${F('Department', 'dept', { v: s.dept })}${F('Role', 'role', { v: s.role, opts: ROLES })}${F('Employment status', 'status', { v: s.status, opts: ['Active', 'On notice', 'Inactive'] })}${F('User access', 'access', { v: s.access, opts: ['Enabled', 'Disabled'] })}${F('Availability', 'avail', { v: s.avail, opts: ['Available', 'On leave', 'Unavailable'] })}${F('Leave from', 'lf', { t: 'date', v: s.leave ? s.leave.from : '' })}${F('Leave to', 'lt', { t: 'date', v: s.leave ? s.leave.to : '' })}${F('Temporary cover (reassignment)', 'backup', { v: s.backup, opts: S.staff.filter((x) => x.role === 'Counsellor' && x.id !== s.id).map((x) => [x.id, x.name]), blank: 'None' })}${F('Maximum weighted workload', 'max', { t: 'number', min: 0, v: s.max, help: 'Counsellors only' })}<div class="sec">Programmes handled (routing eligibility)</div><div class="f full"><div class="chips">${S.programs.map((p) => `<label class="chip" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="p_${p.id}"${s.programs.includes(p.id) ? ' checked' : ''}>${esc(p.name)}</label>`).join('')}</div></div></div>`,
  };
};
SUB.staff = (d, f) => {
  if (!need(f, d, ['name', 'emp', 'email'])) return;
  const oid = d.oid;
  if (S.staff.find((s) => s.emp === d.emp && s.id !== oid)) {
    setErr(f, 'emp', 'Employee ID already exists');
    return;
  }
  if (d.lf && d.lt && d.lt < d.lf) {
    setErr(f, 'lt', 'Leave end is before start');
    return;
  }
  if (d.avail === 'On leave' && !(d.lf && d.lt)) {
    setErr(f, 'lf', 'Enter leave dates for “On leave”');
    return;
  }
  const o = {
    name: d.name,
    emp: d.emp,
    email: d.email,
    mobile: d.mobile,
    branch: d.branch,
    dept: d.dept,
    role: d.role,
    status: d.status,
    access: d.access,
    avail: d.avail,
    max: +d.max || 0,
    backup: d.backup,
    programs: S.programs.filter((p) => d['p_' + p.id]).map((p) => p.id),
    leave: d.avail !== 'Available' && d.lf ? { from: d.lf, to: d.lt, reason: 'Leave' } : null,
  };
  if (oid)
    Object.assign(
      S.staff.find((s) => s.id === oid),
      o,
    );
  else S.staff.push(Object.assign({ id: 'S' + (20 + S.staff.length) }, o));
  closeModal();
  cfgSave('Staff ' + d.name, d.role + ', ' + branchName(d.branch) + ', programmes: ' + o.programs.length);
};
/* roles */
const RES_LABEL = {
  leads: 'Leads',
  opportunities: 'Opportunities',
  enrollments: 'Enrolments',
  students: 'Student profiles',
  student_docs: 'Student documents',
  payments: 'Payments & receipts',
  discount_requests: 'Discount requests',
  branch_transfers: 'Branch transfers',
  reassignment: 'Counsellor reassignment',
  reports: 'Reports',
  configuration: 'Configuration',
  audit_logs: 'Audit logs',
};
const CAPS = [
  ['V', 'View'],
  ['C', 'Create'],
  ['E', 'Edit'],
  ['A', 'Approve'],
  ['D', 'Delete'],
];
function navFor(role) {
  const out = [];
  NAV.forEach(([sec, items]) =>
    items.forEach((it) => {
      const r = it[3];
      let ok =
        r === null ||
        (r === '*appr' &&
          ['discount_requests', 'branch_transfers', 'reassignment'].some((x) =>
            (S.perms[x][role] || '').includes('V'),
          )) ||
        (r === '*any' && (S.perms.configuration[role] || '').includes('V')) ||
        (S.perms[r] && (S.perms[r][role] || '').includes(it[4] === 'C' ? 'C' : 'V'));
      if (ok && !out.includes(it[1])) out.push(it[1]);
    }),
  );
  return out;
}
CFG.roles = () => {
  const pr = S.rolePrev || 'Counsellor';
  return (
    card(
      'Permission matrix',
      `<div class="tbl-wrap"><table class="tbl mx"><thead><tr><th>Resource</th>${ROLES.map((r) => `<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>${Object.keys(
        S.perms,
      )
        .map(
          (res) =>
            `<tr><td><b>${RES_LABEL[res] || res}</b></td>${ROLES.map((r) => `<td>${CAPS.map((c) => `<span class="pc ${S.perms[res][r].includes(c[0]) ? 'on' : ''}" tabindex="0" title="${c[1]} – ${r}" data-act="permTog" data-res="${res}" data-role="${esc(r)}" data-c="${c[0]}">${c[0]}</span>`).join('')}</td>`).join('')}</tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><p class="muted xs">V view · C create · E edit · A approve · D delete. Clicking toggles a permission immediately and is audited. Branch-level visibility follows each user’s branch access (Admissions Heads cover UAE or India; Management and System Administrators see all).</p>`,
      { np: 0 },
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Role preview',
      `<div class="row" style="margin-bottom:10px"><select data-change="rolePrev" aria-label="Role">${ROLES.map((r) => `<option${pr === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div><div class="grid g2"><div><div class="sec" style="margin-top:0">Screens available</div><div class="chips">${navFor(
        pr,
      )
        .map((n) => `<span class="badge info">${esc(n)}</span>`)
        .join('')}</div></div><div><div class="sec" style="margin-top:0">Capabilities</div>${dl(
        Object.keys(S.perms).map((r) => [
          RES_LABEL[r],
          S.perms[r][pr]
            ? S.perms[r][pr]
                .split('')
                .map((c) => CAPS.find((x) => x[0] === c)[1])
                .join(', ')
            : 'No access',
        ]),
      )}</div></div>`,
    )
  );
};
ACT.permTog = (d) => {
  const cur = S.perms[d.res][d.role];
  if (d.res === 'configuration' && d.role === 'System Administrator' && d.c === 'V') {
    toast('System Administrator keeps configuration access to avoid lock-out', 'warn');
    return;
  }
  S.perms[d.res][d.role] = cur.includes(d.c) ? cur.replace(d.c, '') : cur + d.c;
  addAudit('Permission changed', d.res, d.role + ': ' + S.perms[d.res][d.role]);
  render();
};
CHG.rolePrev = (el) => {
  S.rolePrev = el.value;
  render();
};
