/* LMS (LOF booking platform) enrol/cancel calls and settings. */
/* ---------- LMS integration (LOF booking platform) ---------- */
function lmsAccess(e) {
  const L = S.cfg.lms || {},
    prog = S.programs.find((x) => x.id === e.prog) || { name: e.prog },
    pkg = L.packages && L.packages[e.prog] && L.packages[e.prog][e.pkg],
    legacy = (L.programmes || {})[e.prog],
    code = pkg || legacy || {};
  return {
    source: pkg ? 'package' : legacy ? 'legacy' : 'missing',
    items:
      code.items ||
      (code.track
        ? [{ product_name: prog.name + ' – ' + e.pkg, track: code.track, credits: (code.credits || []).slice() }]
        : []),
    skillslabs: code.skillslabs || [],
  };
}
function lmsEnrolmentSummary(e) {
  const access = lmsAccess(e),
    lines = access.items.map((item) => {
      const credits = item.credits || [];
      return `Track <span class="mono">${esc(item.track)}</span> · ${credits.length} ${credits.length === 1 ? 'Credit' : 'Credits'}${credits.length ? ': <span class="mono">' + esc(credits.join(', ')) + '</span>' : ' (Credit codes not configured)'}`;
    });
  access.skillslabs.forEach((lab) => {
    lines.push(
      `Skills Lab <span class="mono">${esc(lab.program)}</span> · ${esc(lab.sessions)} ${lab.sessions === 1 ? 'session' : 'sessions'}${lab.valid_until ? ' · valid until ' + esc(dayFmt(lab.valid_until)) : ''}`,
    );
  });
  if (!lines.length)
    lines.push('LMS access is not mapped for this package. Configure it under Settings → LMS Integration.');
  else if (access.source === 'legacy')
    lines.unshift(
      'Legacy programme mapping shown for reference. Configure this package under Settings → LMS Integration before live delivery.',
    );
  else if (!S.cfg.lms.confirmed) lines.unshift('Package codes are awaiting LOF confirmation before live delivery.');
  lines.push(
    'Access valid until ' + esc(dayFmt(addDays(addMonthsDay(e.date, +S.cfg.lms.validMonths || 12), -1))) + '.',
    'Purchase after full payment. No payment data is sent.',
  );
  return lines.join('<br>');
}
function lmsPayload(e) {
  const frozen = (S.ms || []).find((m) => m.enr === e.id && m.op !== 'cancel' && m.payload);
  if (frozen) return JSON.parse(JSON.stringify(frozen.payload));
  const s = stuById(e.stu),
    p = (s.parents || [])[0] || {},
    L = S.cfg.lms,
    access = lmsAccess(e);
  return {
    reference: e.id,
    student_id: s.id,
    student_first_name: s.first,
    student_last_name: s.last,
    student_email: s.email || '',
    student_phone: s.mobile || p.mobile || '',
    student_dob: s.dob || '',
    parent_id: s.fam || '',
    parent_name: p.name || '',
    parent_email: p.email || '',
    parent_phone: p.mobile || '',
    branch: L.branchMap[e.branch] || '',
    valid_until: addDays(addMonthsDay(e.date, +L.validMonths || 12), -1),
    items: access.items,
    skillslabs: access.skillslabs,
  };
}
const LMS_MUST = [
  'reference',
  'student_id',
  'student_first_name',
  'student_last_name',
  'student_email',
  'student_phone',
  'student_dob',
  'branch',
  'valid_until',
];
function lmsMissing(pl) {
  const m = LMS_MUST.filter((k) => !String(pl[k] || '').trim());
  if (
    pl.student_email &&
    pl.parent_email &&
    pl.student_email.trim().toLowerCase() === pl.parent_email.trim().toLowerCase()
  )
    m.push('student email must differ from parent email');
  if (!pl.items.length && !pl.skillslabs.length) m.push('at least one Track or Skills Lab line');
  pl.items.forEach((x, i) => {
    if (!x.track) m.push('items[' + i + '].track');
    if (!x.credits.length) m.push('items[' + i + '].credits');
  });
  return m;
}
const LMS_FIELDS = [
  [
    'A',
    'reference',
    'Your own order number – used so the same purchase is never applied twice',
    'Enrolment ID (EN-26-…)',
    'Must',
  ],
  ['A', 'student_id', 'Permanent student id', 'LOF Student ID (LOF-26-…)', 'Must'],
  ['A', 'student_first_name', '', 'Student first name', 'Must'],
  ['A', 'student_last_name', '', 'Student last name', 'Must'],
  [
    'A',
    'student_email',
    'Creates or matches the LMS account',
    'Student LMS login e-mail; must differ from the parent',
    'Must',
  ],
  ['A', 'student_phone', 'With country code', 'Student mobile; parent mobile when blank', 'Must'],
  ['A', 'student_dob', 'YYYY-MM-DD', 'Student date of birth', 'Must'],
  ['A', 'parent_id', 'Lets siblings share one parent account', 'Family ID (FAM-26-…)', 'Optional'],
  ['A', 'parent_name', '', 'Primary parent name', 'Optional'],
  ['A', 'parent_email', '', 'Primary parent e-mail', 'Optional'],
  ['A', 'parent_phone', '', 'Primary parent mobile', 'Optional'],
  ['A', 'branch', 'Student’s default centre', 'Branch code map (below)', 'Must'],
  ['A', 'valid_until', 'Date access ends, YYYY-MM-DD', 'Enrolment date + validity months − 1 day', 'Must'],
  ['B', 'product_name', 'Shown to the student and staff', 'Programme name – package', 'Optional'],
  ['B', 'track', 'LMS Track code', 'Package access mapping: Track', 'Must'],
  ['B', 'credits', 'Exact LMS Credit codes, as a list', 'Package access mapping: purchased Credit codes', 'Must'],
  ['C', 'reference', 'Same order number as the enrol call', 'Enrolment ID', 'Must'],
];
CFG.lms = () => {
  const tab = S.lmsTab || 'calls',
    L = S.cfg.lms,
    I = S.cfg.integ.lms;
  const seg = `<div class="seg" style="margin-bottom:14px">${[
    ['calls', 'Calls'],
    ['setup', 'Setup'],
    ['sample', 'Sample data'],
  ]
    .map((t) => `<a class="${tab === t[0] ? 'on' : ''}" data-act="lmsTab" data-t="${t[0]}" tabindex="0">${t[1]}</a>`)
    .join('')}</div>`;
  const banner = `<div class="banner">${ic('alert')}<span>LOF CRM to LMS Integration Guide v1.1 (2 November 2026). Send a <b>purchase after full payment</b> and a <b>cancel on withdrawal</b>. Receipt means the order reached LMS; staff processing and student access verification are separate. <b>No payment or refund data is sent.</b>${L.confirmed ? '' : ' Track and Credit codes below are <b>placeholders</b> until LOF issues the real list.'}</span></div>`;
  let body = '';
  if (tab === 'calls') {
    const tb = (sec) =>
      table(
        'lmsf' + sec,
        [
          { h: 'Field', f: (r) => `<span class="mono">${r[1]}</span>` },
          { h: 'What it is', f: (r) => esc(r[2]) },
          { h: 'Taken from (CRM)', f: (r) => esc(r[3]) },
          { h: 'Required', f: (r) => bdg(r[4], r[4] === 'Must' ? 'info' : '') },
        ],
        LMS_FIELDS.filter((r) => r[0] === sec),
        { all: 1 },
      );
    body =
      card('Purchase call – sent once per paid order', tb('A'), { np: 1 }) +
      '<div style="height:14px"></div>' +
      card(
        'Product block – repeated for each product in the enrolment',
        `<div class="bd" style="padding:12px 14px 0"><p class="muted sm" style="margin:0">The number of credits bought is the number of Credit codes sent – no count is sent separately. Skills Lab products send the purchased session count (one 2-hour class uses 2 sessions).</p></div>` +
          tb('B'),
        { np: 1 },
      ) +
      '<div style="height:14px"></div>' +
      card(
        'Cancel call – sent when an enrolment is withdrawn or refunded',
        `<div class="bd" style="padding:12px 14px 0"><p class="muted sm" style="margin:0">The LMS withdraws whatever is still unused.</p></div>` +
          tb('C'),
        { np: 1 },
      );
  }
  if (tab === 'setup') {
    const progs = S.programs.filter((p) => p.active);
    const brs = S.branches;
    const codeRows = lmsPackageRows()
      .map((row, i) => {
        const c = (L.packages && L.packages[row.prog] && L.packages[row.prog][row.pkg]) || {};
        if ((c.items || []).length > 1 || (c.skillslabs || []).length > 1)
          return `<tr><td>${esc(PNAME(row.prog))}<br>${esc(row.pkg)}</td><td colspan="4">Multiple product lines configured through the API; this form preserves them.</td></tr>`;
        const t = (c.items || [])[0] || c,
          lab = (c.skillslabs || [])[0] || {};
        return `<tr><td><b>${esc(PNAME(row.prog))}</b><br>${esc(row.pkg)}</td><td>${F('Track code', 't_' + i, { v: t.track || '' })}</td><td>${F('Purchased Credit codes', 'c_' + i, { v: (t.credits || []).join(', '), help: 'Exact codes from LOF; comma separated.' })}</td><td>${F('Skills Lab program', 'sl_' + i, { v: lab.program || '' })}</td><td>${F('Skills Lab sessions', 'ses_' + i, { t: 'number', min: 1, step: 1, v: lab.sessions || '' })}</td></tr>`;
      })
      .join('');
    const ready = lmsReadiness();
    body =
      card(
        'Connection',
        cfgForm(
          'lmsConn',
          `${swRow('Send enrol and cancel calls to the LMS', 'on', I.on)}<div class="fgrid" style="margin-top:10px">${F('Endpoint address', 'ep', { v: 'Server secret LMS_URL', dis: 1, help: 'Set on the server with the security token (LMS_TOKEN); never stored in the browser.' })}${F('Access valid for (months)', 'vm', { t: 'number', min: 1, max: 60, v: L.validMonths, help: 'valid_until = enrolment date + this many months − 1 day.' })}${F('Retry limit', 'retryMax', { t: 'number', min: 0, v: I.retryMax })}${F('Retry interval (minutes)', 'retryMin', { t: 'number', min: 1, v: I.retryMin })}${F('Failure alerts to', 'notify', { v: I.notify })}</div>`,
          { ok: 'Save connection' },
        ) +
          `<div style="margin-top:8px"><button class="btn sm" type="button" data-act="testInteg" data-k="lms">Test connection</button></div>`,
      ) +
      '<div style="height:14px"></div>' +
      card(
        'Package access mappings',
        cfgForm(
          'lmsCodes',
          `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Programme / package</th><th>Track</th><th>Purchased Credits</th><th>Skills Lab</th><th>Sessions</th></tr></thead><tbody>${codeRows}</tbody></table></div><div class="fgrid" style="margin-top:10px">${F(
            'Codes status',
            'confirmed',
            {
              v: L.confirmed ? '1' : '0',
              opts: [
                ['0', 'Placeholders – waiting for LOF’s code list'],
                ['1', 'Confirmed with LOF'],
              ],
            },
          )}</div>`,
          { ok: 'Save codes' },
        ),
      ) +
      '<div style="height:14px"></div>' +
      card(
        'Branch code map',
        cfgForm(
          'lmsBranches',
          `<div class="fgrid">${brs.map((b) => F(b.name + ' (' + b.id + ')', 'b_' + b.id, { v: L.branchMap[b.id] || '', help: b.status === 'Operating' ? '' : 'Branch not operating yet' })).join('')}</div>`,
          { ok: 'Save branch codes' },
        ),
      ) +
      '<div style="height:14px"></div>' +
      card(
        'Field mapping',
        table(
          'lmsmap',
          [
            { h: 'LMS field', f: (r) => `<span class="mono">${r[1]}</span>` },
            { h: 'Call', f: (r) => ({ A: 'Enrol', B: 'Enrol · per product', C: 'Cancel' })[r[0]] },
            { h: 'CRM source', f: (r) => esc(r[3]) },
            { h: 'Required', f: (r) => r[4] },
          ],
          LMS_FIELDS,
          { all: 1 },
        ),
        { np: 1 },
      ) +
      '<div style="height:14px"></div>' +
      card(
        'Readiness checklist',
        `<div class="list" style="margin:-14px">${ready.map((r) => `<div><span>${r.ok ? bdg('Ready', 'ok') : bdg('Open', 'warn')} ${esc(r.t)}${r.d ? `<br><span class="muted xs">${esc(r.d)}</span>` : ''}</span></div>`).join('')}</div>`,
      );
  }
  if (tab === 'sample') {
    const es = S.enr.filter((e) => inScope(e.branch));
    const pick = enrById(S.lmsSample) || es[0];
    const pl = pick ? lmsPayload(pick) : null,
      miss = pl ? lmsMissing(pl) : [];
    body = card(
      'Sample of what would be sent',
      `<div class="tb" style="border:0;padding:0 0 12px"><select data-change="lmsSample" aria-label="Enrolment">${es.map((e) => `<option value="${e.id}"${pick && pick.id === e.id ? ' selected' : ''}>${e.id} · ${esc(stuById(e.stu).first + ' ' + stuById(e.stu).last)} · ${esc(PNAME(e.prog))}</option>`).join('')}</select></div>` +
        (pl
          ? `${miss.length ? `<div class="banner" style="background:var(--warn-bg)">${ic('alert')}<span>This enrolment would not be sent yet – missing: ${esc(miss.join(', '))}</span></div>` : ''}<div class="sec">Enrol call</div><pre class="mono sm" style="white-space:pre-wrap;background:var(--bg2,#f6f7f9);padding:12px;border-radius:6px;overflow:auto">${esc(JSON.stringify(Object.assign({ wsfunction: 'local_lofplatform_erp_purchase' }, pl), null, 2))}</pre><div class="sec">Cancel call</div><pre class="mono sm" style="white-space:pre-wrap;background:var(--bg2,#f6f7f9);padding:12px;border-radius:6px">${esc(JSON.stringify({ wsfunction: 'local_lofplatform_erp_cancel', reference: pl.reference }, null, 2))}</pre>`
          : emptyBox('No enrolments', 'Enrol a student to see a sample.')),
    );
  }
  return banner + seg + body;
};
function lmsReadiness() {
  const L = S.cfg.lms,
    progs = S.programs.filter((p) => p.active),
    ops = S.branches.filter((b) => b.status === 'Operating');
  const missingPackages = lmsPackageRows().filter((row) => {
    const c = (L.packages && L.packages[row.prog] && L.packages[row.prog][row.pkg]) || {};
    return !(c.track && (c.credits || []).length) && !(c.items || []).length && !(c.skillslabs || []).length;
  });
  const noBr = ops.filter((b) => !L.branchMap[b.id]);
  return [
    {
      t: 'Exact purchased access mapped for every package',
      ok: !missingPackages.length,
      d: missingPackages.map((r) => PNAME(r.prog) + ' / ' + r.pkg).join(', '),
    },
    { t: 'Codes confirmed with LOF (not placeholders)', ok: !!L.confirmed },
    { t: 'Every operating branch has an LMS branch code', ok: !noBr.length, d: noBr.map((b) => b.name).join(', ') },
    {
      t: 'Endpoint address and token set on the server',
      ok: !!S.lmsServerReady,
      d: 'LMS_URL and LMS_TOKEN (System Administrator checks this in Settings → Testing console)',
    },
    { t: 'Integration switched on', ok: !!S.cfg.integ.lms.on },
    { t: 'Connection test passed', ok: !!S.lmsTestOk },
  ];
}
ACT.lmsTab = (d) => {
  S.lmsTab = d.t;
  render();
};
CHG.lmsSample = (el) => {
  S.lmsSample = el.value;
  render();
};
SUB.cfg_lmsConn = (d, f) => {
  const I = S.cfg.integ.lms;
  if (!(+d.vm >= 1 && +d.vm <= 60)) {
    setErr(f, 'vm', 'Enter 1 to 60 months');
    return;
  }
  if (!(+d.retryMax >= 0) || !(+d.retryMin >= 1)) {
    toast('Retry limit must be ≥ 0 and interval ≥ 1 minute', 'err');
    return;
  }
  Object.assign(I, { on: !!d.on, retryMax: +d.retryMax, retryMin: +d.retryMin, notify: d.notify });
  S.cfg.lms.validMonths = +d.vm;
  cfgSave('LMS connection', (I.on ? 'enabled' : 'disabled') + ', valid ' + d.vm + ' months');
};
function lmsPackageRows() {
  const seen = new Set();
  return S.fees
    .filter((f) => f.active && S.programs.some((p) => p.id === f.prog && p.active))
    .filter((f) => {
      const key = f.prog + '|' + f.pkg;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f) => ({ prog: f.prog, pkg: f.pkg }));
}
SUB.cfg_lmsCodes = (d, f) => {
  const packages = JSON.parse(JSON.stringify(S.cfg.lms.packages || {}));
  let problem = '';
  lmsPackageRows().forEach((row, i) => {
    const old = (packages[row.prog] || {})[row.pkg] || {};
    if ((old.items || []).length > 1 || (old.skillslabs || []).length > 1) return;
    const track = String(d['t_' + i] || '').trim();
    const credits = String(d['c_' + i] || '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    const program = String(d['sl_' + i] || '').trim(),
      sessions = +d['ses_' + i];
    if (
      (track && !/^[A-Za-z0-9._-]{1,64}$/.test(track)) ||
      credits.some((c) => !/^[A-Za-z0-9._-]{1,64}$/.test(c)) ||
      new Set(credits).size !== credits.length ||
      !!track !== !!credits.length
    )
      problem = 'Each Track needs its exact, unique Credit codes from LOF.';
    if (
      (program && (!/^[A-Za-z0-9._-]{1,64}$/.test(program) || !Number.isInteger(sessions) || sessions <= 0)) ||
      (!program && sessions > 0)
    )
      problem = 'Each Skills Lab needs its program code and a positive whole session count.';
    packages[row.prog] ||= {};
    packages[row.prog][row.pkg] = {
      track,
      credits,
      skillslabs: program
        ? [
            {
              program,
              sessions,
              ...(old.skillslabs && old.skillslabs[0] && old.skillslabs[0].valid_until
                ? { valid_until: old.skillslabs[0].valid_until }
                : {}),
            },
          ]
        : [],
    };
  });
  if (problem) {
    toast(problem, 'err');
    return;
  }
  S.cfg.lms.packages = packages;
  S.cfg.lms.confirmed = d.confirmed === '1';
  cfgSave('LMS package mappings', 'Exact purchased access mapped per programme and package');
};
SUB.cfg_lmsBranches = (d) => {
  S.branches.forEach((b) => {
    S.cfg.lms.branchMap[b.id] = String(d['b_' + b.id] || '').trim();
  });
  cfgSave(
    'LMS branch codes',
    Object.entries(S.cfg.lms.branchMap)
      .map((x) => x.join('→'))
      .join(', '),
  );
};

function runSync(id) {
  const m = S.ms.find((x) => x.id === id);
  if (!m) return;
  const e = enrById(m.enr),
    s = stuById(m.stu),
    op = m.op || 'enrol';
  if (op === 'enrol' && e.payStatus !== 'Paid') {
    m.status = 'Awaiting Payment';
    toast('LMS purchase waits until full payment', 'warn');
    render();
    return;
  }
  m.status = 'Processing';
  m.attempts++;
  m.hist.push({
    at: nowIso(),
    s: 'Processing',
    msg: (op === 'cancel' ? 'Cancel' : 'Enrol') + ' call started – reference ' + e.id,
  });
  render();
  setTimeout(() => {
    const t = nowIso(),
      pl = lmsPayload(e),
      miss = op === 'enrol' ? lmsMissing(pl) : [];
    m.last = t;
    if (S.sim.moodleOutage || miss.length) {
      m.status = miss.length ? 'Failed' : m.attempts >= S.cfg.integ.lms.retryMax ? 'Retry Required' : 'Failed';
      m.err = miss.length
        ? 'Not sent – missing ' + miss.join(', ')
        : 'HTTP 503 Service Unavailable (simulated outage toggle is on)';
      m.hist.push({ at: t, s: m.status, msg: m.err });
      notify(
        'moodle',
        'crit',
        'LMS ' + op + ' call failed for ' + s.first + ' ' + s.last + ' (' + m.enr + '): ' + m.err,
        { page: 'integration' },
        ['Admissions Head', 'System Administrator', 'Centre Administrator'],
        e.branch,
      );
    } else {
      m.status = 'Success';
      m.err = '';
      m.hist.push({
        at: t,
        s: 'Success',
        msg:
          op === 'cancel'
            ? 'LMS withdrew unused credits for reference ' + e.id
            : 'LMS received reference ' +
              e.id +
              ': Track ' +
              ((pl.items[0] || {}).track || (pl.skillslabs[0] || {}).program || '') +
              ' with ' +
              pl.items.reduce((n, x) => n + x.credits.length, 0) +
              ' credit(s), valid until ' +
              pl.valid_until,
      });
      notify(
        'moodle',
        'ok',
        'LMS ' + op + ' call succeeded for ' + s.first + ' ' + s.last + ' (' + m.enr + ')',
        { page: 'integration' },
        ['Admissions Head', 'System Administrator', 'Centre Administrator'],
        e.branch,
      );
    }
    addAudit('LMS ' + op + ' call', m.id, m.status + ' (simulated)', 'System');
    render();
    toast(
      m.status === 'Success'
        ? 'LMS ' + op + ' call succeeded (simulated)'
        : 'LMS ' + op + ' call ' + m.status.toLowerCase() + ': ' + m.err,
      m.status === 'Success' ? 'ok' : 'err',
    );
  }, 1300);
}
const msCall = (m) => ((m.op || 'enrol') === 'cancel' ? 'Cancel' : 'Enrol');
PAGES.integration = () => {
  const I = S.cfg.integ,
    ms = S.ms.filter((m) => inScope(enrById(m.enr).branch));
  const cnt = (k) => ms.filter((m) => m.status === k).length;
  const adm = can('configuration', 'V');
  const others = [
    ['Website lead capture', I.web.on ? 'Enabled (configuration)' : 'Disabled', I.web.note],
    ['Meta lead integration', I.meta.on ? 'Enabled (configuration)' : 'Disabled', I.meta.note],
    ['WhatsApp', I.wa.on ? 'Connected' : 'Not connected', I.wa.note],
    ['Telephony – ' + I.tel.provider, I.tel.on ? 'Connected' : 'Not connected', I.tel.note],
    ['Payment gateway', I.pay.on ? 'Connected' : 'Not connected', 'Mode: ' + I.pay.mode],
    ['ERPNext Accounts', I.erp.on ? 'Connected' : 'Not connected', I.erp.note],
    ['Calendar sync', I.cal.on ? 'Connected' : 'Not connected', I.cal.note],
  ];
  return (
    ph(
      'Integration Monitor',
      'LMS enrol and cancel calls, and integration status',
      `<button class="btn" data-act="testInteg" data-k="lms">Test connection</button>${adm ? `<button class="btn" data-act="go" data-page="config" data-tab="lms">LMS settings</button>` : ''}`,
    ) +
    `<div class="banner">${ic('alert')}LMS is <b>not connected</b> in this prototype. Calls below are simulated.</div><div class="kpis">${['Success', 'Awaiting Payment', 'Awaiting Setup', 'Warnings', 'Processing', 'Pending', 'Failed', 'Retry Required'].map((k) => `<div class="kpi ${['Failed', 'Retry Required'].includes(k) && cnt(k) ? 'crit' : ''}" style="cursor:default"><div class="l">${k}</div><div class="v">${cnt(k)}</div></div>`).join('')}</div><div class="grid g2">${card(
      'LMS connection',
      dl([
        ['Status', bdg(I.lms.on ? 'Enabled' : 'Not connected – simulated', I.lms.on ? 'ok' : 'warn')],
        ['Endpoint and token', 'Server secrets (LMS_URL, LMS_TOKEN)'],
        ['Calls', 'Purchase after full payment · cancel on withdrawal'],
        ['Retry limit / interval', I.lms.retryMax + ' attempts · every ' + I.lms.retryMin + ' min'],
        ['Failure alerts to', esc(I.lms.notify)],
        ['Duplicate protection', 'The LMS applies each reference (enrolment ID) once'],
      ]) +
        `<div class="row" style="margin-top:12px"><label class="chk sm"><input type="checkbox" data-change="outage"${S.sim.moodleOutage ? ' checked' : ''}> Simulate LMS outage for next calls (demo)</label></div>`,
    )}${card(
      'Other integrations',
      table(
        'oth',
        [
          { h: 'Integration', f: (r) => esc(r[0]) },
          { h: 'Status', f: (r) => bdg(r[1], r[1] === 'Connected' || r[1].startsWith('Enabled') ? 'ok' : 'warn') },
          { h: 'Note', f: (r) => esc(r[2]) },
        ],
        others,
        { all: 1 },
      ),
      { np: 1 },
    )}</div><div style="height:14px"></div>` +
    card(
      'LMS call log',
      table(
        'ms',
        [
          {
            h: 'Call',
            f: (m) => `<span class="mono">${m.id}</span><div class="muted xs">${msCall(m)}</div>`,
            s: (m) => m.id,
          },
          {
            h: 'Student / enrolment',
            f: (m) => {
              const s = stuById(m.stu);
              return `<a ${sgo(s.id)}>${esc(s.first + ' ' + s.last)}</a><div class="muted xs"><span class="mono">${s.id}</span> · ${m.enr}</div>`;
            },
          },
          {
            h: 'Product',
            f: (m) =>
              esc(m.course || '') +
              `<div class="mono muted xs">${esc(m.cid || '')}${m.credits && m.credits.length ? ' · ' + m.credits.length + ' credit(s)' : ''}</div>`,
          },
          { h: 'Status', f: (m) => stB(m.status), s: (m) => m.status },
          { h: 'Last attempt', f: (m) => fDT(m.last), s: (m) => m.last },
          { h: 'Attempts', f: (m) => m.attempts, r: 1 },
          { h: 'Error details', f: (m) => `<span class="sm" style="color:var(--crit)">${esc(m.err)}</span>` },
          {
            h: '',
            f: (m) =>
              `<div class="row"><button class="btn sm" data-act="msHist" data-id="${m.id}">History</button>${['Failed', 'Retry Required', 'Awaiting Setup'].includes(m.status) ? `<button class="btn sm primary" data-act="retrySync" data-id="${m.id}">Retry</button>` : ''}</div>`,
          },
        ],
        ms,
        { ps: 10 },
      ),
      { np: 1 },
    )
  );
};
MODALS.msHist = (m) => {
  const x = S.ms.find((y) => y.id === m.id);
  return {
    title: 'LMS call history – ' + x.id,
    body: `<p class="sm">${msCall(x)} call · enrolment ${x.enr} · Track ${esc(x.cid || '—')}${x.credits && x.credits.length ? ' · credits ' + esc(x.credits.join(', ')) : ''}</p>${timeline(x.hist.map((h) => ({ at: h.at, text: h.s + ' – ' + h.msg, type: h.s === 'Failed' || h.s === 'Retry Required' ? 'crit' : h.s === 'Success' ? 'msg' : 'sys', by: 'LMS connector' })))}`,
    foot: `<button class="btn" data-act="closeModal">Close</button>`,
  };
};
ACT.testInteg = (d) => {
  if (d.k === 'lms') {
    S.lmsTestOk = true;
    render();
    toast('Simulated test: LMS responded OK (no live API is connected)', 'warn');
    addAudit('LMS test connection', 'Integration', 'Simulated result: OK');
    return;
  }
  toast('Simulated test: ' + d.k + ' – no live service is connected, so no request was sent.', 'warn');
  addAudit('Integration test', 'Integration', d.k + ' (simulated)');
};
CHG.outage = (el) => {
  S.sim.moodleOutage = el.checked;
  toast(el.checked ? 'Next LMS calls will fail (simulated outage)' : 'Simulated outage off', 'warn');
  render();
};
