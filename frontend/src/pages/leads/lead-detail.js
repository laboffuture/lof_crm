/* Lead record tabs and its actions: calls, messages, follow-ups, conversion, transfer. */
/* ====== lead detail ====== */
const LTABS = [
  ['overview', 'Overview'],
  ['parent', 'Parent & Student'],
  ['activity', 'Activities & Calls'],
  ['tasks', 'Follow-ups & Tasks'],
  ['interests', 'Program Interests'],
  ['opps', 'Opportunities'],
  ['comms', 'Communications'],
  ['assign', 'Branch & Assignment'],
  ['docs', 'Documents & Consents'],
  ['audit', 'Audit Trail'],
];
PAGES.lead = (rt) => {
  const l = leadById(rt.id);
  if (!l || !inScope(l.branch))
    return (
      ph('Lead not found', '') + card('', emptyBox('This lead does not exist or is outside your branch access.', ''))
    );
  const s = sla(l),
    tab = S.tab,
    edit = can('leads', 'E'),
    open = l.status === 'Open';
  const act = edit
    ? `${open ? `<button class="btn" data-act="mCall" data-id="${l.id}">${ic('phone')} Call</button><button class="btn" data-act="mWa" data-id="${l.id}">${ic('chat')} WhatsApp</button><button class="btn" data-act="mMail" data-id="${l.id}">${ic('mail')} Email</button><button class="btn" data-act="mFu" data-id="${l.id}">${ic('cal')} Schedule follow-up</button><button class="btn" data-act="mCat" data-id="${l.id}">Change category</button><button class="btn primary" data-act="startConvert" data-id="${l.id}">Create opportunity</button><button class="btn" data-act="mTransfer" data-id="${l.id}">Request branch transfer</button><button class="btn danger" data-act="mLost" data-id="${l.id}">Mark as lost</button>` : `<span class="badge">${esc(l.status)} – read-only actions</span>`}<button class="btn" data-act="mEditLead" data-id="${l.id}">Edit</button>${open && (can('reassignment', 'E') || can('reassignment', 'C')) ? `<button class="btn" data-act="mReassign" data-id="${l.id}">${can('reassignment', 'E') ? 'Reassign' : 'Request reassignment'}</button>` : ''}${l.status === 'Closed' && can('leads', 'E') ? `<button class="btn" data-act="reopen" data-id="${l.id}">Reopen</button>` : ''}`
    : '<span class="muted sm">View only for your role</span>';
  const sum = `<div class="sum"><div class="it"><small>Lead</small><b style="font-size:16px">${esc(l.student)}</b> <span class="mono muted">${l.id}</span></div><div class="it"><small>Category</small>${catB(l.cat)}${l.cat === 'No Response' ? ` <span class="badge warn">Attempt ${l.noResp} / ${S.cfg.life.noRespMax}</span>` : ''}</div><div class="it"><small>Stage / status</small>${esc(l.stage)} · ${stB(l.status)}</div><div class="it"><small>First-call SLA</small>${slaB(l)}${s.s === 'Breached' ? `<span class="muted xs"> +${s.over} min over</span>` : ''}</div><div class="it"><small>Counsellor</small>${l.cslr ? esc(staffName(l.cslr)) : bdg('Unassigned', 'warn')}</div><div class="it"><small>Branch · programme</small>${esc(branchName(l.branch))} · ${esc(PNAME(l.prog))}</div><div class="it"><small>Parent</small>${esc(l.parent)}</div><div class="it"><small>Mobile</small><span class="mono">${esc(l.phone)}</span></div><div class="it"><small>Next follow-up</small>${l.nextFU ? fDT(l.nextFU) : '—'}</div></div>`;
  return `<div class="ph"><div><div class="muted sm"><a ${goA('leads', { preset: 'all' })}>Leads</a> / ${l.id}</div></div></div>${sum}<div class="row" style="margin-bottom:14px">${act}</div>${l.status === 'Closed' ? `<div class="banner" style="background:var(--neu-bg);color:var(--neu)">Closed: ${esc(l.closeReason)}</div>` : ''}${tabsBar(LTABS, tab, 'lTab')}${leadTab(l, tab)}`;
};
ACT.lTab = (d) => {
  S.tab = d.k;
  render();
};
function timeline(evs) {
  return `<div class="tl">${
    evs
      .slice()
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map(
        (e) =>
          `<div class="ev ${e.type || ''}"><div>${esc(e.text)}</div><div class="t">${fDT(e.at)} · ${esc(e.by || 'System')} · ${rel(e.at)}</div></div>`,
      )
      .join('') || emptyBox('No activity yet')
  }</div>`;
}
function leadTab(l, tab) {
  const calls = S.calls.filter((c) => c.lead === l.id),
    tasks = S.tasks.filter((t) => t.lead === l.id),
    opps = S.opps.filter((o) => o.lead === l.id),
    comms = S.comms.filter((c) => c.lead === l.id).sort((a, b) => new Date(b.at) - new Date(a.at)),
    edit = can('leads', 'E') && l.status === 'Open';
  if (tab === 'overview')
    return `<div class="grid g2"><div>${card('Activity timeline', timeline(l.events))}</div><div class="grid">${card(
      'Snapshot',
      dl([
        ['Source', esc(l.src)],
        ['Campaign', esc(l.camp)],
        ['Enquiry', fDT(l.enq) + ' · ' + rel(l.enq)],
        ['Last activity', rel(l.last)],
        ['Programme interest', (l.interests || [l.prog]).map(PNAME).join(', ')],
        ['Open task', openTask(l) ? esc(openTask(l).type) + ' · ' + fDT(openTask(l).due) : '—'],
        ['Consents', 'WhatsApp ' + (l.wa ? '✓' : '✗') + ' · Email ' + (l.em ? '✓' : '✗')],
        ['Notes', esc(l.notes)],
      ]),
    )}${l.status === 'Open' ? card('Follow-up rule for ' + l.cat, S.cfg.cad[l.cat] ? `<p class="sm" style="margin:0">Initial follow-up within <b>${S.cfg.cad[l.cat].h} h</b>, then every <b>${S.cfg.cad[l.cat].every} days</b>${S.cfg.cad[l.cat].forD ? ' for ' + S.cfg.cad[l.cat].forD + ' days' : ''}. Editable under SLA & Follow-up Rules.</p>` : l.cat === 'No Response' ? `<p class="sm" style="margin:0">Attempt <b>${l.noResp} of ${S.cfg.life.noRespMax}</b>. The lead closes automatically after ${S.cfg.life.noRespMax} unanswered attempts. Retries follow the original category (${esc(l.origCat || '—')}).</p>` : '<p class="sm" style="margin:0">No follow-up. A standardised reason is mandatory.</p>') : ''}</div></div>`;
  if (tab === 'parent')
    return `<div class="grid g2">${card(
      'Student',
      dl([
        ['Name', esc(l.student)],
        ['Date of birth', l.dob ? fD(l.dob) + ' (age ' + age(l.dob) + ')' : '—'],
        ['Age', l.age || '—'],
        ['School', esc(l.school)],
        ['Grade', esc(l.grade)],
        ['Curriculum', esc(l.curr)],
      ]),
      { act: can('leads', 'E') ? `<button class="btn sm" data-act="mEditLead" data-id="${l.id}">Edit</button>` : '' },
    )}${card(
      'Parent / guardian',
      dl([
        ['Name', esc(l.parent)],
        [
          'Mobile',
          '<span class="mono">' +
            esc(l.phone) +
            '</span> <button class="btn sm ghost" data-act="copy" data-v="' +
            esc(l.phone) +
            '">Copy</button>',
        ],
        ['Email', esc(l.email)],
      ]),
    )}${S.cfg.fields.length ? card('Custom fields', dl(S.cfg.fields.map((f) => [f.n, esc((l.custom || {})[f.n])]))) : ''}</div>`;
  if (tab === 'activity')
    return (
      card(
        'Call log',
        table(
          'lcalls',
          [
            { h: 'Date', f: (c) => fDT(c.at) },
            { h: 'Direction', f: (c) => c.dir },
            { h: 'From → To', f: (c) => `<span class="mono">${esc(c.from)} → ${esc(c.to)}</span>` },
            { h: 'Duration', f: (c) => c.dur + ' min' },
            { h: 'Status', f: (c) => esc(c.status) },
            { h: 'Outcome', f: (c) => esc(c.outcome) + (c.first ? ' ' + bdg('First call', 'info') : '') },
            { h: 'Notes', f: (c) => esc(c.notes) + (c.sim ? ' ' + SIMTAG : '') },
            { h: 'Recording', f: (c) => (c.rec ? esc(c.rec) : '<span class="faint">—</span>') },
          ],
          calls,
          { all: 1, et: 'No calls logged', ed: 'Use Call to log an attempt.' },
        ),
        { np: 1 },
      ) +
      '<div style="height:14px"></div>' +
      card('Timeline', timeline(l.events))
    );
  if (tab === 'tasks')
    return card(
      'Follow-ups & tasks',
      table('ltasks', taskCols(), tasks, { all: 1, et: 'No tasks', ed: 'Schedule a follow-up to create one.' }),
      { np: 1, act: edit ? `<button class="btn sm" data-act="mFu" data-id="${l.id}">Schedule follow-up</button>` : '' },
    );
  if (tab === 'interests') {
    const ints = l.interests || [l.prog];
    const fee = feeFor(S, l.prog, l.branch, 'Term (24 sessions)');
    return `<div class="grid g2">${card(
      'Programme interests',
      `<div class="chips">${S.programs
        .filter((p) => p.active)
        .map(
          (p) =>
            `<a class="chip ${ints.includes(p.id) ? 'on' : ''}" tabindex="0" data-act="${edit ? 'leadInt' : 'noop'}" data-id="${l.id}" data-p="${p.id}">${esc(p.name)}</a>`,
        )
        .join(
          '',
        )}</div><p class="muted sm">Primary interest: <b>${esc(PNAME(l.prog))}</b>.${edit ? ' Click to add or remove additional interests.' : ''}</p>`,
    )}${card(
      'Indicative pricing at ' + esc(branchName(l.branch)),
      fee
        ? dl([
            ['Package', esc(fee.pkg)],
            ['Fee', money(fee.amt, fee.cur)],
            ['Registration (new students)', money(fee.extra.amt, fee.cur)],
            ['Tax', fee.tax + '%'],
            ['Sessions', fee.sessions],
          ])
        : '<p class="muted">No active fee record for this branch and programme.</p>',
    )}</div>`;
  }
  if (tab === 'opps')
    return card(
      'Opportunities',
      table(
        'lopps',
        [
          { h: 'Opportunity', f: (o) => `<a ${goA('opps')}>${o.id}</a>` },
          { h: 'Programme', f: (o) => esc(PNAME(o.prog)) },
          {
            h: 'Stage',
            f: (o) => bdg(o.stage, { Enrolled: 'ok', Lost: 'crit', 'Admission Decision': 'warn' }[o.stage] || 'info'),
          },
          {
            h: 'Fee',
            f: (o) => {
              const f = feeFor(S, o.prog, o.branch, o.pkg);
              return f ? money(f.amt, f.cur) : '—';
            },
          },
          { h: 'Next action', f: (o) => esc(o.next) },
        ],
        opps,
        {
          all: 1,
          et: 'No opportunity yet',
          ed:
            l.stage === 'Qualified'
              ? 'This lead is qualified. Use Create opportunity.'
              : 'Mark the lead Qualified, then convert it.',
        },
      ),
      { np: 1 },
    );
  if (tab === 'comms') {
    const av = l.avail;
    return `<div class="grid g2"><div>${card(
      'Communication history',
      table(
        'lcomm',
        [
          { h: 'Time', f: (c) => fDT(c.at) },
          { h: 'Channel', f: (c) => esc(c.ch) },
          { h: 'Template', f: (c) => esc(c.tpl) },
          { h: 'Message', f: (c) => esc(c.text) },
          { h: 'Delivery', f: (c) => bdg(c.status, c.status.startsWith('Blocked') ? 'crit' : 'info') },
        ],
        comms,
        { all: 1 },
      ),
      {
        np: 1,
        act: edit
          ? `<button class="btn sm" data-act="mWa" data-id="${l.id}">WhatsApp</button><button class="btn sm" data-act="mMail" data-id="${l.id}">Email</button>`
          : '',
      },
    )}</div><div class="grid">${card('Parent call availability', `${!av ? `<p class="muted sm" style="margin:0">${l.wa ? 'No availability request sent yet.' : 'No WhatsApp consent – the automated request was not sent.'}</p>` : av.s === 'Requested' ? `<p class="sm" style="margin:0 0 10px">WhatsApp request sent. Waiting for the parent’s preferred time.</p>${edit ? `<button class="btn sm" data-act="mAvail" data-id="${l.id}">Simulate parent reply</button>` : ''}` : `<p class="sm" style="margin:0 0 8px">Parent prefers <b>${fDT(av.slot)}</b>. ${av.s === 'Scheduled' ? bdg('Added to follow-ups', 'ok') : ''}</p>${av.s === 'Received' && edit ? `<button class="btn primary sm" data-act="schedSlot" data-id="${l.id}">Schedule requested slot</button>` : ''}<p class="muted xs">Calendar sync (Google/Outlook) is a configurable placeholder and is not connected. The slot is added to the CRM follow-up calendar.</p>`}`)}${card(
      'Consent status',
      dl([
        ['WhatsApp', l.wa ? bdg('Granted', 'ok') : bdg('Not granted', 'crit')],
        ['Email', l.em ? bdg('Granted', 'ok') : bdg('Not granted', 'crit')],
        ['Automation rule', 'Messages are blocked without matching consent'],
      ]),
    )}</div></div>`;
  }
  if (tab === 'assign')
    return `<div class="grid g2">${card(
      'Assignment history',
      table(
        'lasg',
        [
          { h: 'When', f: (a) => fDT(a.at) },
          { h: 'From', f: (a) => esc(staffName(a.from)) },
          { h: 'To', f: (a) => esc(staffName(a.to)) },
          { h: 'Method', f: (a) => esc(a.how) },
          { h: 'By', f: (a) => esc(a.by) },
          { h: 'Reason', f: (a) => esc(a.reason) },
        ],
        l.assign.slice().reverse(),
        { all: 1, et: 'No assignment yet' },
      ),
      { np: 1 },
    )}${card(
      'Branch transfers',
      table(
        'ltr',
        [
          { h: 'Request', f: (a) => a.id },
          { h: 'From → To', f: (a) => esc(branchName(a.payload.from)) + ' → ' + esc(branchName(a.payload.to)) },
          { h: 'Status', f: (a) => stB(a.status) },
          { h: 'Requested', f: (a) => fDT(a.at) },
        ],
        S.approvals.filter((a) => a.type === 'Branch Transfer' && a.payload.lead === l.id),
        { all: 1, et: 'No transfers', ed: 'Current branch: ' + branchName(l.branch) },
      ),
      { np: 1 },
    )}</div>`;
  if (tab === 'docs') {
    const dc = can('student_docs', 'V');
    return `<div class="grid g2">${card(
      'Consents',
      dl([
        ['WhatsApp communication', l.wa ? bdg('Granted', 'ok') : bdg('Not granted', 'crit')],
        ['Email communication', l.em ? bdg('Granted', 'ok') : bdg('Not granted', 'crit')],
        ['Captured', fDT(l.enq) + ' (' + esc(l.src) + ')'],
      ]) +
        (can('leads', 'E')
          ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-act="toggleConsent" data-id="${l.id}" data-k="wa">${l.wa ? 'Withdraw' : 'Record'} WhatsApp consent</button><button class="btn sm" data-act="toggleConsent" data-id="${l.id}" data-k="em">${l.em ? 'Withdraw' : 'Record'} email consent</button></div>`
          : ''),
    )}${card('Documents', dc ? emptyBox('No documents uploaded', 'Student documents are collected at enrolment and visible in the Student 360° profile.') : emptyBox('Restricted', 'Student documents are visible to Centre Administrators, Admissions Heads and System Administrators.'))}</div>`;
  }
  if (tab === 'audit')
    return card(
      'Audit trail',
      table(
        'laud',
        [
          { h: 'When', f: (a) => fDT(a.at) },
          { h: 'User', f: (a) => esc(a.by) },
          { h: 'Action', f: (a) => esc(a.act) },
          { h: 'Detail', f: (a) => esc(a.det) },
        ],
        S.audit.filter((a) => a.ref === l.id),
        { all: 1, et: 'No audited changes yet' },
      ),
      { np: 1 },
    );
  return '';
}
function taskCols() {
  return [
    {
      h: 'Due',
      f: (t) => fDT(t.due) + (t.status === 'Pending' && new Date(t.due) < NOW ? ' ' + bdg('Overdue', 'crit') : ''),
      s: (t) => t.due,
    },
    {
      h: 'Lead',
      f: (t) => {
        const l = leadById(t.lead);
        return `<a ${lgo(l.id)}>${esc(l.student)}</a>`;
      },
    },
    { h: 'Counsellor', f: (t) => esc(staffName(t.cslr)) },
    { h: 'Type', f: (t) => esc(t.type) },
    {
      h: 'Status',
      f: (t) =>
        stB(t.status === 'Done' ? 'Completed' : t.status === 'Cancelled' ? '' : t.status) +
        (t.status === 'Cancelled' ? bdg('Cancelled') : ''),
    },
    { h: 'Remarks / outcome', f: (t) => esc(t.outcome || t.remarks) },
    {
      h: '',
      f: (t) =>
        t.status === 'Pending' && can('leads', 'E')
          ? `<button class="btn sm" data-act="mTaskDone" data-id="${t.id}">Complete</button>`
          : '',
    },
  ];
}
Object.assign(ACT, {
  noop() {},
  copy(d) {
    navigator.clipboard &&
      navigator.clipboard.writeText(d.v).then(
        () => toast('Copied'),
        () => toast('Select the number and copy manually', 'warn'),
      );
  },
  mCall: (d) => openModal('callLog', { id: d.id }),
  mWa: (d) => openModal('wa', { id: d.id }),
  mMail: (d) => openModal('mail', { id: d.id }),
  mFu: (d) => openModal('fu', { id: d.id }),
  mCat: (d) => openModal('cat', { id: d.id }),
  mTransfer: (d) => openModal('transfer', { id: d.id }),
  mLost: (d) => openModal('lostLead', { id: d.id }),
  mEditLead: (d) => openModal('leadForm', { id: d.id }),
  mReassign: (d) => openModal('reassign', { id: d.id }),
  mAvail: (d) => openModal('avail', { id: d.id }),
  mTaskDone: (d) => openModal('taskDone', { id: d.id }),
  reopen(d) {
    const l = leadById(d.id);
    l.status = 'Open';
    l.closeReason = '';
    l.noResp = 0;
    if (l.cat === 'Not Interested' || l.cat === 'No Response') l.cat = l.origCat || 'Warm';
    scheduleNext(l, l.cat, true);
    syncNext(l);
    addEv(l, 'sys', 'Lead reopened');
    addAudit('Lead reopened', l.id, '');
    render();
    toast('Lead reopened', 'ok');
  },
  leadInt(d) {
    const l = leadById(d.id);
    l.interests = l.interests || [l.prog];
    const i = l.interests.indexOf(d.p);
    if (i >= 0) {
      if (d.p === l.prog) {
        toast('Primary interest cannot be removed', 'warn');
        return;
      }
      l.interests.splice(i, 1);
    } else l.interests.push(d.p);
    addAudit('Programme interests changed', l.id, l.interests.join(', '));
    render();
  },
  toggleConsent(d) {
    const l = leadById(d.id);
    l[d.k] = !l[d.k];
    addEv(l, 'sys', (d.k === 'wa' ? 'WhatsApp' : 'Email') + ' consent ' + (l[d.k] ? 'recorded' : 'withdrawn'));
    addAudit('Consent changed', l.id, d.k + ' → ' + l[d.k]);
    render();
    toast('Consent updated', 'ok');
  },
  schedSlot(d) {
    const l = leadById(d.id);
    S.tasks.push({
      id: 'T-' + S.seq.task++,
      lead: l.id,
      cslr: l.cslr,
      due: l.avail.slot,
      type: 'Scheduled call',
      status: 'Pending',
      remarks: 'Parent-requested slot',
      outcome: '',
      next: '',
    });
    l.avail.s = 'Scheduled';
    syncNext(l);
    addEv(l, 'sys', 'Parent-requested slot scheduled as follow-up for ' + fDT(l.avail.slot));
    render();
    toast('Slot added to the follow-up calendar', 'ok');
  },
  startConvert(d) {
    const l = leadById(d.id);
    if (l.stage !== 'Qualified') {
      confirmBox(
        'Lead is not qualified yet',
        'Only qualified leads convert to opportunities. Mark <b>' +
          esc(l.student) +
          '</b> as Qualified now and continue?',
        'qualify',
        l.id,
        'Mark Qualified & continue',
      );
    } else openModal('convert', { id: l.id });
  },
});
CONFIRM.qualify = (id) => {
  const l = leadById(id);
  l.stage = 'Qualified';
  addEv(l, 'sys', 'Stage changed to Qualified');
  addAudit('Lead stage changed', id, '→ Qualified');
  openModal('convert', { id });
};
/* lead modals */
const OUTC = [
  'Interested – counselling booked',
  'Interested – needs time',
  'Information only',
  'Callback requested',
  'Not interested',
  'Wrong number',
  'No answer',
];
MODALS.callLog = (m) => {
  const l = leadById(m.id);
  return {
    title: 'Log call – ' + l.student,
    form: 'callLog',
    ok: 'Save call log',
    body: `<input type="hidden" name="id" value="${l.id}"><div class="banner">${ic('phone')}<span>Telephony provider: <b>${esc(S.cfg.integ.tel.provider)}</b> – not connected. Calls are logged manually and labelled simulated.</span></div><div class="row" style="margin-bottom:12px"><span class="mono">${esc(l.phone)}</span><span class="muted sm">${esc(l.parent)}</span>${!l.fc ? bdg('First call', 'info') : ''}</div><div class="fgrid">${F('Direction', 'dir', { opts: ['Outgoing', 'Incoming'], v: 'Outgoing' })}${F('Call status', 'status', { opts: ['Completed', 'Not answered', 'Busy', 'Voicemail'], v: 'Completed' })}${F('Outcome', 'outcome', { opts: OUTC, blank: 'Select outcome', req: 1 })}${F('Duration (minutes)', 'dur', { t: 'number', min: 0, v: 0 })}${F('Next follow-up (optional)', 'next', { t: 'datetime-local', help: 'If empty, the cadence for the category is applied.' })}${F('Call notes', 'notes', { t: 'textarea', full: 1 })}</div>${l.cat !== 'No Response' && l.noResp ? '' : ''}<p class="muted sm">Choosing “No answer” counts as an unanswered attempt. After ${S.cfg.life.noRespMax} attempts the lead closes automatically.</p>`,
  };
};
SUB.callLog = (d, f) => {
  if (!need(f, d, ['outcome'])) return;
  if (d.outcome === 'No answer') d.status = 'Not answered';
  else if (d.status !== 'Completed' && d.outcome !== 'No answer') {
    setErr(f, 'outcome', 'Use “No answer” when the call was not connected');
    return;
  }
  const l = leadById(d.id);
  const r = logCall(l, d);
  closeModal();
  toast(
    r.closed
      ? 'Call logged – lead closed after ' + S.cfg.life.noRespMax + ' unanswered attempts'
      : 'Call logged (simulated telephony)',
    r.closed ? 'warn' : 'ok',
  );
};
MODALS.wa = (m) => {
  const l = leadById(m.id);
  const ts = S.cfg.comms.filter((t) => t.ch === 'WhatsApp');
  return {
    title: 'WhatsApp – ' + l.parent,
    form: 'wa',
    ok: 'Send (simulated)',
    body: `<input type="hidden" name="id" value="${l.id}">${!l.wa ? `<div class="banner" style="background:var(--crit-bg);color:var(--crit)">No WhatsApp consent recorded. Sending is blocked until consent is captured.</div>` : `<div class="banner">${ic('chat')}<span>WhatsApp Business is not connected – messages are recorded as simulated.</span></div>`}<div class="fgrid">${F('Template', 'tpl', { opts: ts.map((t) => [t.id, t.n + (t.auto ? ' (auto)' : '')]), v: ts[0].id, chg: 'tplFill' })}${F('Message', 'text', { t: 'textarea', rows: 5, full: 1, v: msgFrom(ts[0].body, l), req: 1 })}</div>`,
  };
};
MODALS.mail = (m) => {
  const l = leadById(m.id);
  const ts = S.cfg.comms.filter((t) => t.ch === 'Email');
  return {
    title: 'Email – ' + l.parent,
    form: 'mail',
    ok: 'Send (simulated)',
    body: `<input type="hidden" name="id" value="${l.id}">${!l.em ? `<div class="banner" style="background:var(--crit-bg);color:var(--crit)">No email consent recorded. Sending is blocked.</div>` : ''}<div class="fgrid">${F('To', 'to', { v: l.email, dis: 1 })}${F('Template', 'tpl', { opts: ts.map((t) => [t.id, t.n]), v: ts[0].id, chg: 'tplFill' })}${F('Subject', 'subj', { v: 'Your enquiry at Lab of Future ' + branchName(l.branch), req: 1, full: 1 })}${F('Message', 'text', { t: 'textarea', rows: 6, full: 1, v: msgFrom(ts[0].body, l), req: 1 })}</div>`,
  };
};
CHG.tplFill = (el) => {
  const f = el.form,
    l = leadById(f.querySelector('[name=id]').value),
    t = S.cfg.comms.find((x) => x.id === el.value);
  f.querySelector('[name=text]').value = msgFrom(t.body, l);
};
['wa', 'mail'].forEach(
  (k) =>
    (SUB[k] = (d, f) => {
      if (!need(f, d, ['text'])) return;
      const l = leadById(d.id),
        wa = k === 'wa';
      if (wa ? !l.wa : !l.em) {
        setErr(f, 'text', 'Blocked: no ' + (wa ? 'WhatsApp' : 'email') + ' consent recorded for this contact');
        return;
      }
      const t = S.cfg.comms.find((x) => x.id === d.tpl);
      S.comms.push({
        id: 'CM' + S.seq.cm++,
        lead: l.id,
        ch: wa ? 'WhatsApp' : 'Email',
        tpl: t ? t.n : 'Custom',
        text: d.text,
        at: nowIso(),
        status: 'Sent (simulated)',
        by: me().name,
      });
      addEv(
        l,
        'msg',
        (wa ? 'WhatsApp' : 'Email') + ' sent (simulated): ' + d.text.slice(0, 80) + (d.text.length > 80 ? '…' : ''),
      );
      addAudit((wa ? 'WhatsApp' : 'Email') + ' sent', l.id, 'Template ' + (t ? t.n : 'custom'));
      closeModal();
      toast((wa ? 'WhatsApp' : 'Email') + ' recorded as sent (simulated)', 'ok');
    }),
);
MODALS.fu = (m) => {
  const l = leadById(m.id);
  const due = new Date(NOW.getTime() + 864e5);
  return {
    title: 'Schedule follow-up – ' + l.student,
    form: 'fu',
    ok: 'Schedule',
    body: `<input type="hidden" name="id" value="${l.id}"><div class="fgrid">${F('Follow-up type', 'type', { opts: ['Follow-up call', 'WhatsApp follow-up', 'Email follow-up', 'Centre visit', 'Trial class'], v: 'Follow-up call' })}${F('Due date / time', 'due', { t: 'datetime-local', v: locVal(due.toISOString()), req: 1 })}${F('Assigned counsellor', 'cs', { v: l.cslr || '', opts: optCslr(l.branch), blank: 'Unassigned', dis: 1 })}${F('Remarks', 'remarks', { t: 'textarea', full: 1 })}</div>`,
  };
};
SUB.fu = (d, f) => {
  if (!need(f, d, ['due'])) return;
  const l = leadById(d.id);
  const due = locIso(d.due);
  if (new Date(due) < NOW) {
    setErr(f, 'due', 'Choose a time in the future');
    return;
  }
  S.tasks.push({
    id: 'T-' + S.seq.task++,
    lead: l.id,
    cslr: l.cslr,
    due,
    type: d.type,
    status: 'Pending',
    remarks: d.remarks,
    outcome: '',
    next: '',
  });
  syncNext(l);
  addEv(l, 'sys', d.type + ' scheduled for ' + fDT(due));
  addAudit('Follow-up scheduled', l.id, d.type + ' ' + fDT(due));
  closeModal();
  toast('Follow-up scheduled for ' + fDT(due), 'ok');
};
MODALS.cat = (m) => {
  const l = leadById(m.id);
  return {
    title: 'Change category – ' + l.student,
    form: 'cat',
    ok: 'Update category',
    body: `<input type="hidden" name="id" value="${l.id}"><div class="fgrid">${F('Current category', 'cur', { v: l.cat, dis: 1 })}${F('New category', 'cat', { opts: CATS, v: l.cat, req: 1 })}${F('Reason (mandatory for Not Interested)', 'reason', { opts: S.cfg.life.niReasons, blank: 'Select reason', full: 1 })}</div><p class="muted sm">Hot/Warm/Cold create the next follow-up from the configured cadence. Not Interested closes the lead and cancels open tasks. No Response starts the unanswered-attempt counter.</p>`,
  };
};
SUB.cat = (d, f) => {
  const l = leadById(d.id);
  clearErrs(f);
  if (d.cat === l.cat) {
    setErr(f, 'cat', 'Choose a different category');
    return;
  }
  if (d.cat === 'Not Interested' && !d.reason) {
    setErr(f, 'reason', 'A standardised reason is mandatory for Not Interested');
    return;
  }
  changeCat(l, d.cat, d.reason);
  closeModal();
  toast('Category changed to ' + d.cat + (S.cfg.cad[d.cat] ? ' – follow-up scheduled' : ''), 'ok');
};
MODALS.lostLead = (m) => {
  const l = leadById(m.id);
  return {
    title: 'Mark as lost – ' + l.student,
    form: 'lostLead',
    ok: 'Mark as lost',
    danger: 1,
    body: `<input type="hidden" name="id" value="${l.id}"><div class="fgrid">${F('Lost reason', 'reason', { opts: S.cfg.life.lostReasons, blank: 'Select reason', req: 1, full: 1 })}${F('Remarks', 'remarks', { t: 'textarea', full: 1 })}</div>`,
  };
};
SUB.lostLead = (d, f) => {
  if (!need(f, d, ['reason'])) return;
  const l = leadById(d.id);
  l.status = 'Lost';
  l.lostReason = d.reason;
  cancelTasks(l, 'Lead lost');
  l.nextFU = null;
  addEv(l, 'warn', 'Marked as lost – ' + d.reason + (d.remarks ? ' · ' + d.remarks : ''));
  addAudit('Lead lost', l.id, d.reason);
  closeModal();
  toast('Lead marked as lost', 'ok');
};
MODALS.convert = (m) => {
  const l = leadById(m.id);
  const fees = S.fees.filter((x) => x.active && x.prog === l.prog && x.branch === l.branch);
  return {
    title: 'Create opportunity – ' + l.student,
    form: 'convert',
    ok: 'Create opportunity',
    body: `<input type="hidden" name="id" value="${l.id}">${!fees.length ? '<div class="banner" style="background:var(--crit-bg);color:var(--crit)">No active fee record for this branch and programme. Add pricing under Fees & Pricing.</div>' : ''}<div class="fgrid">${F('Programme', 'p', { v: PNAME(l.prog), dis: 1 })}${F('Package', 'pkg', { opts: fees.map((x) => [x.pkg, x.pkg + ' – ' + money(x.amt, x.cur)]), req: 1, chg: 'convFee' })}${F('Expected enrolment date', 'exp', { t: 'date', v: dayKey(dAt(7, 0)), req: 1 })}${F('Next action', 'next', { v: 'Send fee breakdown and book enrolment slot' })}</div><div id="convFee" style="margin-top:12px">${fees[0] ? feeBox(fees[0], null, true) : ''}</div><p class="muted sm">Once converted, the lead is excluded from open-lead workload calculations.</p>`,
  };
};
function feeBox(f, disc, isNew) {
  const c = calcFee(f, disc, isNew);
  return `<div class="card"><div class="bd"><dl class="kv"><dt>Package fee</dt><dd class="num">${money(c.base, f.cur)}</dd><dt>Registration (new students)</dt><dd class="num">${money(c.extra, f.cur)}</dd><dt>Discount</dt><dd class="num">− ${money(c.disc, f.cur)}</dd><dt>Tax (${f.tax}%)</dt><dd class="num">${money(c.tax, f.cur)}</dd><dt><b>Total payable</b></dt><dd class="num"><b>${money(c.total, f.cur)}</b></dd></dl></div></div>`;
}
CHG.convFee = (el) => {
  const l = leadById(el.form.querySelector('[name=id]').value);
  const f = feeFor(S, l.prog, l.branch, el.value);
  $('#convFee').innerHTML = f ? feeBox(f, null, true) : '';
};
SUB.convert = (d, f) => {
  if (!need(f, d, ['pkg', 'exp'])) return;
  const l = leadById(d.id);
  if (!feeFor(S, l.prog, l.branch, d.pkg)) {
    setErr(f, 'pkg', 'No active fee for this package');
    return;
  }
  const o = convertLead(l, d);
  closeModal();
  toast('Opportunity ' + o.id + ' created – lead removed from open workload', 'ok');
  go('opps');
};
MODALS.transfer = (m) => {
  const l = leadById(m.id);
  return {
    title: 'Request branch transfer – ' + l.student,
    form: 'transfer',
    ok: 'Submit request',
    body: `<input type="hidden" name="id" value="${l.id}"><div class="fgrid">${F('Current branch', 'from', { v: branchName(l.branch), dis: 1 })}${F('Requested branch', 'to', { opts: S.branches.filter((b) => b.status === 'Operating' && b.id !== l.branch).map((b) => [b.id, b.name]), blank: 'Select branch', req: 1 })}${F('Transfer reason', 'reason', { opts: ['Family relocating', 'Closer to home', 'Programme not offered at current branch', 'Schedule preference', 'Other'], blank: 'Select reason', req: 1 })}${F('Remarks', 'remarks', { t: 'textarea', full: 1 })}</div><p class="muted sm">Workflow: Transfer request → Admissions Head review → Approve / Reject → Branch updated. Allowed at any lifecycle stage.</p>`,
  };
};
SUB.transfer = (d, f) => {
  if (!need(f, d, ['to', 'reason'])) return;
  const l = leadById(d.id);
  if (S.approvals.find((a) => a.type === 'Branch Transfer' && a.status === 'Pending' && a.payload.lead === l.id)) {
    toast('A transfer request for this lead is already pending', 'warn');
    return;
  }
  const a = newApproval(
    'Branch Transfer',
    { lead: l.id, from: l.branch, to: d.to, reason: d.reason },
    'Transfer ' + l.student + ': ' + branchName(l.branch) + ' → ' + branchName(d.to),
    d.reason + (d.remarks ? ' – ' + d.remarks : ''),
    l.branch,
    'lead',
    l.id,
  );
  addEv(l, 'sys', 'Branch transfer requested: ' + branchName(l.branch) + ' → ' + branchName(d.to) + ' (' + a.id + ')');
  notify(
    'transfer',
    'info',
    'Branch transfer requested: ' + a.summary,
    { page: 'approvals' },
    ['Admissions Head', 'System Administrator'],
    l.branch,
  );
  closeModal();
  toast('Transfer request ' + a.id + ' sent to the Admissions Head', 'ok');
};
MODALS.reassign = (m) => {
  const l = leadById(m.id);
  const direct = can('reassignment', 'E');
  const el = eligibility(S, l.branch, l.prog, l.cat);
  return {
    title: (direct ? 'Reassign – ' : 'Request reassignment – ') + l.student,
    size: 'lg',
    form: 'reassign',
    ok: direct ? 'Reassign' : 'Submit request',
    body: `<input type="hidden" name="id" value="${l.id}"><div class="fgrid">${F('Current counsellor', 'cur', { v: staffName(l.cslr), dis: 1 })}${F('New counsellor', 'to', { opts: optCslr().map((o) => [o[0], o[1] + (el.find((e) => e.s.id === o[0]) && el.find((e) => e.s.id === o[0]).why ? '  (' + el.find((e) => e.s.id === o[0]).why + ')' : '')]), blank: 'Select counsellor', req: 1 })}${F('Reason', 'reason', { req: 1, full: 1 })}</div><p class="muted sm">${direct ? 'Manual reassignment by your role needs no prior approval; it is written to the assignment history.' : 'Counsellor-initiated reassignment is routed to the Admissions Head (configurable; flagged for business confirmation).'} Selecting a counsellor who is over the limit or on leave is allowed for manual assignment.</p><div class="sec" style="margin-top:6px">Routing view for ${esc(branchName(l.branch))} · ${esc(PNAME(l.prog))}</div>${table(
      'rrx',
      [
        { h: 'Counsellor', f: (r) => esc(r.s.name) },
        { h: 'Branch', f: (r) => r.s.branch },
        { h: 'Availability', f: (r) => esc(r.s.avail) },
        { h: 'Weighted load', f: (r) => r.L.w + ' / ' + r.s.max },
        { h: 'Eligibility', f: (r) => (r.why ? bdg(r.why, 'warn') : bdg('Eligible', 'ok')) },
      ],
      el,
      { all: 1 },
    )}`,
  };
};
SUB.reassign = (d, f) => {
  if (!need(f, d, ['to', 'reason'])) return;
  const l = leadById(d.id);
  if (d.to === l.cslr) {
    setErr(f, 'to', 'Already assigned to this counsellor');
    return;
  }
  if (can('reassignment', 'E')) {
    reassign(l, d.to, d.reason, 'Manual');
    closeModal();
    toast('Lead reassigned to ' + staffName(d.to) + ' – history recorded', 'ok');
  } else {
    const a = newApproval(
      'Counsellor Reassignment',
      { lead: l.id, from: l.cslr, to: d.to },
      'Reassign ' + l.student + ': ' + staffName(l.cslr) + ' → ' + staffName(d.to),
      d.reason,
      l.branch,
      'lead',
      l.id,
    );
    notify(
      'assign',
      'info',
      'Reassignment approval needed: ' + a.summary,
      { page: 'approvals' },
      ['Admissions Head'],
      l.branch,
    );
    closeModal();
    toast('Reassignment request ' + a.id + ' sent for approval', 'ok');
  }
};
MODALS.avail = (m) => ({
  title: 'Simulate parent reply',
  form: 'avail',
  ok: 'Record reply',
  body: `<input type="hidden" name="id" value="${m.id}"><p class="muted sm">Simulates the parent answering the WhatsApp availability request (WhatsApp is not connected).</p><div class="fgrid">${F('Preferred call date / time', 'slot', { t: 'datetime-local', v: locVal(dAt(1, 17)), req: 1 })}</div>`,
});
SUB.avail = (d, f) => {
  if (!need(f, d, ['slot'])) return;
  const l = leadById(d.id);
  l.avail = { s: 'Received', slot: locIso(d.slot) };
  addEv(l, 'msg', 'Parent replied: prefers a call on ' + fDT(l.avail.slot) + ' (simulated)');
  notify(
    'new',
    'info',
    'Parent availability received for ' + l.student + ': ' + fDT(l.avail.slot),
    { page: 'lead', id: l.id },
    ['Counsellor'],
    l.branch,
    l.cslr,
  );
  closeModal();
  toast('Counsellor notified. Slot ready to schedule.', 'ok');
};
MODALS.taskDone = (m) => {
  const t = S.tasks.find((x) => x.id === m.id),
    l = leadById(t.lead);
  return {
    title: 'Complete task – ' + l.student,
    form: 'taskDone',
    ok: 'Complete',
    body: `<input type="hidden" name="id" value="${t.id}"><div class="banner">${ic('phone')}Outcomes that record a call are logged as simulated.</div><div class="fgrid">${F('Task', 'x', { v: t.type + ' · due ' + fDT(t.due), dis: 1, full: 1 })}${F('Call outcome', 'outcome', { opts: OUTC, blank: 'Select outcome', req: 1 })}${F('Next follow-up (optional)', 'next', { t: 'datetime-local' })}${F('Remarks', 'notes', { t: 'textarea', full: 1 })}</div>`,
  };
};
SUB.taskDone = (d, f) => {
  if (!need(f, d, ['outcome'])) return;
  const t = S.tasks.find((x) => x.id === d.id),
    l = leadById(t.lead);
  t.status = 'Done';
  t.remarks = d.notes || t.remarks;
  logCall(l, {
    dir: 'Outgoing',
    status: d.outcome === 'No answer' ? 'Not answered' : 'Completed',
    outcome: d.outcome,
    dur: 2,
    notes: d.notes,
    next: d.next,
  });
  t.status = 'Done';
  t.outcome = d.outcome;
  syncNext(l);
  closeModal();
  toast('Task completed', 'ok');
};
