/* Discount requests, approval queue and history, transfers, reassignment, SLA breaches. */
/* ====== discounts & approvals ====== */
const discApps = () => S.approvals.filter((a) => a.type === 'Exceptional Discount' && inScope(a.branch));
MODALS.discReq = (m) => {
  const opps = visOpps().filter((o) => !['Enrolled', 'Lost'].includes(o.stage));
  const o = m.opp ? oppById(m.opp) : opps[0];
  return {
    title: 'Request exceptional discount',
    size: 'lg',
    form: 'discReq',
    ok: 'Submit for approval',
    body: `<div class="banner">Custom discounts need <b>${esc((S.cfg.wf.find((w) => w.t === 'Exceptional discount') || {}).ap)}</b> approval and are not applied until approved. Predefined discounts are applied directly on the opportunity.</div><div class="fgrid">${F('Opportunity', 'opp', { opts: opps.map((x) => [x.id, x.student + ' · ' + PNAME(x.prog) + ' · ' + branchName(x.branch)]), v: o ? o.id : '', chg: 'discCalc', req: 1 })}${F(
      'Discount type',
      'type',
      {
        opts: [
          ['%', 'Percentage'],
          ['flat', 'Flat amount'],
        ],
        v: '%',
        chg: 'discCalc',
      },
    )}${F('Discount value', 'value', { t: 'number', min: 0, step: '0.01', req: 1, inp: 'discCalc', id: 'dval' })}${F('Reason', 'reason', { opts: ['Financial hardship', 'Sibling / family enrolment', 'Referral', 'Goodwill', 'Other'], blank: 'Select reason', req: 1 })}${F('Supporting remarks', 'rem', { t: 'textarea', full: 1, req: 1 })}</div><div id="discPrev" style="margin-top:12px"></div>`,
  };
};
function discPrev(form) {
  const o = oppById(form.querySelector('[name=opp]').value);
  const box = $('#discPrev');
  if (!o || !box) return;
  const f = feeFor(S, o.prog, o.branch, o.pkg);
  if (!f) {
    box.innerHTML = '';
    return;
  }
  const v = +form.querySelector('[name=value]').value || 0,
    t = form.querySelector('[name=type]').value;
  const d = t === '%' ? r2((f.amt * v) / 100) : Math.min(v, f.amt);
  box.innerHTML = `<div class="card"><div class="bd">${dl([
    ['Student / prospect', esc(o.student)],
    ['Branch · programme', esc(branchName(o.branch)) + ' · ' + esc(PNAME(o.prog))],
    ['Original fee', money(f.amt, f.cur)],
    ['Discount', d ? '− ' + money(d, f.cur) + (t === '%' ? ' (' + v + '%)' : '') : '—'],
    ['Final payable (before tax)', `<b>${money(f.amt - d, f.cur)}</b>`],
    ['Approver', esc((S.cfg.wf.find((w) => w.t === 'Exceptional discount') || {}).ap)],
  ])}</div></div>`;
}
CHG.discCalc = (el) => discPrev(el.form);
INP.discCalc = (el) => discPrev(el.form);
SUB.discReq = (d, f) => {
  if (!need(f, d, ['opp', 'value', 'reason', 'rem'])) return;
  const o = oppById(d.opp),
    fee = feeFor(S, o.prog, o.branch, o.pkg),
    v = +d.value;
  if (!(v > 0)) {
    setErr(f, 'value', 'Enter a value greater than zero');
    return;
  }
  if (d.type === '%' && v > 100) {
    setErr(f, 'value', 'Percentage cannot exceed 100');
    return;
  }
  if (d.type === 'flat' && v > fee.amt) {
    setErr(f, 'value', 'Discount cannot exceed the fee (' + money(fee.amt, fee.cur) + ')');
    return;
  }
  if (o.discReq) {
    setErr(f, 'opp', 'A request is already pending for this opportunity');
    return;
  }
  const disc = d.type === '%' ? r2((fee.amt * v) / 100) : v;
  const a = newApproval(
    'Exceptional Discount',
    { opp: o.id, type: d.type, value: v, orig: fee.amt, disc, final: r2(fee.amt - disc), cur: fee.cur },
    (d.type === '%' ? v + '%' : money(v, fee.cur)) + ' exceptional discount on ' + PNAME(o.prog) + ' – ' + o.student,
    d.reason + ' – ' + d.rem,
    o.branch,
    'opp',
    o.id,
  );
  o.discReq = a.id;
  o.hist.push({ at: nowIso(), by: me().name, text: 'Exceptional discount request ' + a.id + ' submitted' });
  notify(
    'disc',
    'warn',
    'Discount approval required: ' + a.summary,
    { page: 'approvals' },
    ['Management', 'System Administrator'],
    o.branch,
  );
  closeModal();
  toast('Request ' + a.id + ' sent to ' + a.approverRole + '. Discount is not applied until approved.', 'ok');
};
ACT.newDisc = () => openModal('discReq', {});
const apInfo = (a) =>
  a.type === 'Exceptional Discount'
    ? `${a.payload.type === '%' ? a.payload.value + '%' : money(a.payload.value, a.payload.cur)} off ${money(a.payload.orig, a.payload.cur)} → ${money(a.payload.final, a.payload.cur)}`
    : a.type === 'Branch Transfer'
      ? branchName(a.payload.from) + ' → ' + branchName(a.payload.to)
      : staffName(a.payload.from) + ' → ' + staffName(a.payload.to);
PAGES.discountReq = () => {
  const as = discApps();
  const pd = S.discounts.filter((d) => d.active);
  return (
    ph(
      'Discount Requests',
      'Exceptional (custom) discount requests and the predefined discounts available',
      can('discount_requests', 'C')
        ? `<button class="btn primary" data-act="newDisc">${ic('plus')} New exceptional discount request</button>`
        : '',
    ) +
    card(
      'Exceptional discount requests',
      table(
        'dr',
        [
          { h: 'Request', f: (a) => `<span class="mono">${a.id}</span>` },
          {
            h: 'Student / prospect',
            f: (a) => {
              const o = oppById(a.payload.opp);
              return `<a ${OGO(o)}>${esc(o.student)}</a>`;
            },
          },
          { h: 'Opportunity', f: (a) => a.payload.opp },
          { h: 'Branch', f: (a) => esc(branchName(a.branch)) },
          { h: 'Programme', f: (a) => esc(PNAME(oppById(a.payload.opp).prog)) },
          { h: 'Original fee', f: (a) => money(a.payload.orig, a.payload.cur), r: 1 },
          {
            h: 'Discount',
            f: (a) => (a.payload.type === '%' ? a.payload.value + '%' : money(a.payload.value, a.payload.cur)),
          },
          { h: 'Final payable', f: (a) => money(a.payload.final, a.payload.cur), r: 1 },
          { h: 'Requested by', f: (a) => esc(staffName(a.by)) },
          { h: 'Approver', f: (a) => esc(a.approverRole) },
          { h: 'Status', f: (a) => stB(a.status) },
          { h: 'Decision remarks', f: (a) => esc(a.decision ? a.decision.remarks : '') },
        ],
        as,
        { ps: 8, row: (a) => `data-act="apDetail" data-id="${a.id}"`, et: 'No requests' },
      ),
      { np: 1 },
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Predefined discounts (no approval needed)',
      table(
        'pd',
        [
          { h: 'Code', f: (d) => d.id },
          { h: 'Name', f: (d) => esc(d.name) },
          { h: 'Value', f: (d) => (d.type === '%' ? d.value + '%' : 'Flat ' + d.value) },
          { h: 'Eligibility', f: (d) => esc(d.elig) },
          { h: 'Applies to', f: (d) => d.branches },
        ],
        pd,
        { all: 1 },
      ),
      { np: 1, act: `<span class="muted xs">Created and changed only by System Administrators</span>` },
    )
  );
};
PAGES.discountQueue = () => {
  const as = discApps().filter((a) => a.status === 'Pending');
  return (
    ph('Discount Approval Queue', 'Pending exceptional discounts awaiting a decision') +
    card(
      '',
      as.length
        ? table(
            'dq',
            [
              { h: 'Request', f: (a) => a.id },
              { h: 'Student', f: (a) => esc(oppById(a.payload.opp).student) },
              {
                h: 'Branch · programme',
                f: (a) => esc(branchName(a.branch)) + ' · ' + esc(PNAME(oppById(a.payload.opp).prog)),
              },
              { h: 'Request', f: (a) => apInfo(a) },
              { h: 'Reason', f: (a) => esc(a.reason) },
              { h: 'Requested by', f: (a) => esc(staffName(a.by)) + '<div class="muted xs">' + fDT(a.at) + '</div>' },
              { h: '', f: (a) => apBtns(a) },
            ],
            as,
            { all: 1 },
          )
        : emptyBox('Queue is clear', 'No exceptional discounts are waiting.'),
      { np: 1 },
    )
  );
};
function apBtns(a) {
  const c = canDecide(a);
  return `<div class="row"><button class="btn sm primary${c.ok ? '' : ' disabled'}" data-act="${c.ok ? 'apDecide' : 'noop'}" data-id="${a.id}" data-ok="1" title="${esc(c.ok ? '' : c.why)}">Approve</button><button class="btn sm danger${c.ok ? '' : ' disabled'}" data-act="${c.ok ? 'apDecide' : 'noop'}" data-id="${a.id}" data-ok="0" title="${esc(c.ok ? '' : c.why)}">Reject</button><button class="btn sm" data-act="apDetail" data-id="${a.id}">View details</button></div>`;
}
Object.assign(ACT, {
  apDetail: (d) => openModal('apDetail', { id: d.id }),
  apDecide: (d) => openModal('decide', { id: d.id, ok: d.ok === '1' }),
});
MODALS.apDetail = (m) => {
  const a = S.approvals.find((x) => x.id === m.id),
    c = canDecide(a);
  let info = [
    ['Request', esc(a.summary)],
    ['Type', a.type],
    ['Branch', esc(branchName(a.branch))],
    ['Requested by', esc(staffName(a.by)) + ' · ' + fDT(a.at)],
    ['Approver', esc(a.approverRole)],
    ['Reason', esc(a.reason)],
    ['Status', stB(a.status)],
  ];
  if (a.type === 'Exceptional Discount') {
    const o = oppById(a.payload.opp);
    info.push(
      ['Original fee', money(a.payload.orig, a.payload.cur)],
      [
        'Discount',
        a.payload.type === '%'
          ? a.payload.value + '% (' + money(a.payload.disc, a.payload.cur) + ')'
          : money(a.payload.value, a.payload.cur),
      ],
      ['Final payable', money(a.payload.final, a.payload.cur)],
      ['Opportunity', `<a ${OGO(o)} data-close="1">${o.id}</a>`],
    );
  } else {
    const l = leadById(a.payload.lead);
    info.push(['Lead', `<a ${lgo(l.id)} data-close="1">${esc(l.student)} (${l.id})</a>`], ['Change', esc(apInfo(a))]);
  }
  return {
    title: a.id + ' – ' + a.type,
    size: 'lg',
    foot: `<button class="btn" data-act="closeModal">Close</button>${a.status === 'Pending' ? `<button class="btn danger${c.ok ? '' : ' disabled'}" data-act="${c.ok ? 'apDecide' : 'noop'}" data-id="${a.id}" data-ok="0" title="${esc(c.ok ? '' : c.why)}">Reject</button><button class="btn primary${c.ok ? '' : ' disabled'}" data-act="${c.ok ? 'apDecide' : 'noop'}" data-id="${a.id}" data-ok="1" title="${esc(c.ok ? '' : c.why)}">Approve</button>` : ''}`,
    body: `${dl(info)}${a.status === 'Pending' && !c.ok ? `<div class="banner" style="margin-top:12px">You cannot decide this request: ${esc(c.why)}.</div>` : ''}<div class="sec" style="margin-top:14px">Decision history</div>${timeline(a.hist.map((h) => ({ at: h.at, text: h.action + (h.remarks ? ' – ' + h.remarks : ''), by: staffName(h.by), type: h.action === 'Rejected' ? 'crit' : 'sys' })))}`,
  };
};
MODALS.decide = (m) => {
  const a = S.approvals.find((x) => x.id === m.id);
  return {
    title: (m.ok ? 'Approve ' : 'Reject ') + a.id,
    form: 'decide',
    ok: m.ok ? 'Approve' : 'Reject',
    danger: !m.ok,
    size: 'sm2',
    body: `<input type="hidden" name="id" value="${a.id}"><input type="hidden" name="ok" value="${m.ok ? 1 : 0}"><p class="sm">${esc(a.summary)}</p><div class="fgrid">${F('Remarks' + (m.ok ? ' (optional)' : ''), 'rem', { t: 'textarea', full: 1, req: !m.ok })}</div>`,
  };
};
SUB.decide = (d, f) => {
  const ok = d.ok === '1';
  if (!ok && !need(f, d, ['rem'])) return;
  const a = S.approvals.find((x) => x.id === d.id),
    c = canDecide(a);
  if (!c.ok) {
    toast(c.why, 'err');
    return;
  }
  decide(a, ok, d.rem);
  closeModal();
  toast(
    a.id +
      ' ' +
      a.status.toLowerCase() +
      (a.type === 'Branch Transfer' && ok ? ' – branch updated' : '') +
      (a.type === 'Exceptional Discount' && ok ? ' – discount now applied to the opportunity' : ''),
    ok ? 'ok' : 'warn',
  );
};
PAGES.approvals = () => {
  const F2 = S.apF;
  let as = S.approvals.filter(
    (a) =>
      inScope(a.branch) &&
      (!F2.type || a.type === F2.type) &&
      (!F2.branch || a.branch === F2.branch) &&
      (!F2.by || a.by === F2.by) &&
      (!F2.status || a.status === F2.status),
  );
  const types = ['Branch Transfer', 'Counsellor Reassignment', 'Exceptional Discount'];
  const sel = (n, arr, ph) =>
    `<select name="${n}" data-change="apF" aria-label="${ph}"><option value="">${ph}</option>${arr
      .map((a) => {
        const v = Array.isArray(a) ? a[0] : a,
          l = Array.isArray(a) ? a[1] : a;
        return `<option value="${esc(v)}"${F2[n] === v ? ' selected' : ''}>${esc(l)}</option>`;
      })
      .join('')}</select>`;
  return (
    ph(
      'Pending Approvals',
      'Branch transfers, counsellor reassignments and exceptional discounts, each routed by its own configured workflow',
    ) +
    card(
      '',
      `<div class="tb">${sel('type', types, 'All types')}${sel('branch', optBranches(), 'All branches')}${sel(
        'by',
        [...new Set(S.approvals.map((a) => a.by))].map((i) => [i, staffName(i)]),
        'All requesters',
      )}${sel('status', ['Pending', 'Approved', 'Rejected'], 'All statuses')}<span class="muted xs" style="margin-left:auto">Approver is set per type in Approval Workflows</span></div>` +
        table(
          'ap',
          [
            {
              h: 'Request',
              f: (a) =>
                `<span class="mono">${a.id}</span><div>${bdg(a.type, a.type === 'Exceptional Discount' ? 'warn' : 'info')}</div>`,
            },
            { h: 'Summary', f: (a) => esc(a.summary) + '<div class="muted xs">' + esc(apInfo(a)) + '</div>' },
            { h: 'Reason', f: (a) => esc(a.reason) },
            { h: 'Branch', f: (a) => esc(branchName(a.branch)) },
            { h: 'Requested by', f: (a) => esc(staffName(a.by)) + '<div class="muted xs">' + fDT(a.at) + '</div>' },
            { h: 'Approver', f: (a) => esc(a.approverRole) },
            { h: 'Status', f: (a) => stB(a.status) },
            {
              h: 'Actions',
              f: (a) =>
                a.status === 'Pending'
                  ? apBtns(a)
                  : `<button class="btn sm" data-act="apDetail" data-id="${a.id}">View details</button>`,
            },
          ],
          as,
          { ps: 8, et: 'No requests match', ed: 'Change the filters to see other requests.' },
        ),
      { np: 1 },
    )
  );
};
CHG.apF = (el) => {
  S.apF[el.name] = el.value;
  S.tbl.ap && (S.tbl.ap.page = 1);
  render();
};
PAGES.approvalHistory = () => {
  const rows = [];
  S.approvals.filter((a) => inScope(a.branch)).forEach((a) => a.hist.forEach((h) => rows.push({ a, h })));
  rows.sort((x, y) => new Date(y.h.at) - new Date(x.h.at));
  return (
    ph('Approval History', 'Chronological record of every request and decision. Entries cannot be edited.') +
    card(
      '',
      table(
        'ah',
        [
          { h: 'When', f: (r) => fDT(r.h.at) },
          { h: 'Request', f: (r) => `<span class="mono">${r.a.id}</span> ${bdg(r.a.type, 'info')}` },
          { h: 'Summary', f: (r) => esc(r.a.summary) },
          {
            h: 'Action',
            f: (r) =>
              stB(r.h.action === 'Requested' ? 'Pending' : r.h.action) +
              ' ' +
              (r.h.action === 'Requested' ? 'Requested' : ''),
          },
          { h: 'By', f: (r) => esc(staffName(r.h.by)) },
          { h: 'Remarks', f: (r) => esc(r.h.remarks) },
        ],
        rows,
        { ps: 12, row: (r) => `data-act="apDetail" data-id="${r.a.id}"` },
      ),
      { np: 1 },
    )
  );
};
PAGES.transfers = () => {
  const as = S.approvals.filter((a) => a.type === 'Branch Transfer' && inScope(a.branch));
  const ls = leadScope().filter((l) => l.status === 'Open');
  return (
    ph('Branch Transfer Requests', 'Transfer request → Admissions Head review → Approve / Reject → Branch updated') +
    (can('branch_transfers', 'C')
      ? card(
          'Request a transfer',
          `<div class="row"><select id="trlead" aria-label="Lead">${ls.map((l) => `<option value="${l.id}">${esc(l.student)} · ${l.id} · ${esc(branchName(l.branch))}</option>`).join('')}</select><button class="btn primary" data-act="trPick">Request transfer</button></div><p class="muted xs">Transfers are allowed at any lifecycle stage. Previous branch, reason, requester and decision are kept permanently.</p>`,
        )
      : '') +
    '<div style="height:14px"></div>' +
    card(
      'Transfer history',
      table(
        'tr',
        [
          { h: 'Request', f: (a) => a.id },
          {
            h: 'Lead',
            f: (a) => {
              const l = leadById(a.payload.lead);
              return `<a ${lgo(l.id)}>${esc(l.student)}</a>`;
            },
          },
          {
            h: 'Previous → Requested',
            f: (a) => esc(branchName(a.payload.from)) + ' → ' + esc(branchName(a.payload.to)),
          },
          { h: 'Reason', f: (a) => esc(a.payload.reason || a.reason) },
          { h: 'Requested by', f: (a) => esc(staffName(a.by)) + '<div class="muted xs">' + fDT(a.at) + '</div>' },
          {
            h: 'Decision',
            f: (a) =>
              a.decision
                ? esc(staffName(a.decision.by)) + '<div class="muted xs">' + fDT(a.decision.at) + '</div>'
                : '—',
          },
          { h: 'Status', f: (a) => stB(a.status) },
          { h: '', f: (a) => (a.status === 'Pending' ? apBtns(a) : '') },
        ],
        as,
        { ps: 10, et: 'No transfers' },
      ),
      { np: 1 },
    )
  );
};
ACT.trPick = () => {
  const v = $('#trlead').value;
  if (v) openModal('transfer', { id: v });
};
PAGES.reassign = () => {
  const cs = S.staff.filter((s) => s.role === 'Counsellor' && inScope(s.branch));
  const un = leadScope().filter((l) => !l.cslr && l.status === 'Open');
  const direct = can('reassignment', 'E');
  const reqs = S.approvals.filter((a) => a.type === 'Counsellor Reassignment' && inScope(a.branch));
  const hist = [];
  leadScope().forEach((l) => l.assign.forEach((a) => hist.push({ l, a })));
  hist.sort((x, y) => new Date(y.a.at) - new Date(x.a.at));
  return (
    ph(
      'Counsellor Reassignment',
      'Workload, unassigned queue and assignment history',
      `<span class="muted xs">${direct ? 'Your role can assign directly – no prior approval' : 'Reassignment is sent for approval'}</span>`,
    ) +
    card(
      'Counsellor workload',
      table(
        'wl',
        [
          { h: 'Counsellor', f: (s) => `<b>${esc(s.name)}</b>` },
          { h: 'Branch', f: (s) => esc(branchName(s.branch)) },
          { h: 'Programmes', f: (s) => esc(s.programs.map(PNAME).join(', ')) },
          { h: 'Availability', f: (s) => bdg(s.avail, s.avail === 'Available' ? 'ok' : 'warn') },
          { h: 'Open', f: (s) => load(s.id).open, r: 1 },
          {
            h: 'Hot / Warm / Cold',
            f: (s) => {
              const L = load(s.id);
              return L.Hot + ' / ' + L.Warm + ' / ' + L.Cold;
            },
            r: 1,
          },
          { h: 'Weighted', f: (s) => load(s.id).w, r: 1 },
          { h: 'Max', f: (s) => s.max, r: 1 },
          {
            h: 'Load',
            f: (s) =>
              `<div class="bar" style="grid-template-columns:1fr;min-width:90px"><div class="tr"><i style="width:${Math.min(100, (load(s.id).w / s.max) * 100)}%;background:${load(s.id).w >= s.max ? 'var(--c6)' : load(s.id).w / s.max > 0.8 ? 'var(--c5)' : 'var(--c1)'}"></i></div></div>`,
          },
          {
            h: 'Eligible for new leads',
            f: (s) =>
              s.avail !== 'Available'
                ? bdg('No – ' + s.avail.toLowerCase(), 'warn')
                : load(s.id).w >= s.max
                  ? bdg('No – at limit', 'crit')
                  : bdg('Yes', 'ok'),
          },
        ],
        cs,
        { all: 1 },
      ),
      { np: 1 },
    ) +
    `<p class="muted xs">Weights: Hot ${lw('Hot')} · Warm ${lw('Warm')} · Cold ${lw('Cold')}. Converted leads are excluded from open workload.</p><div class="grid g2">` +
    card(
      'Unassigned queue (' + un.length + ')',
      un.length
        ? `<div class="list" style="margin:-14px">${un.map((l) => `<div><span><a ${lgo(l.id)}>${esc(l.student)}</a> ${catB(l.cat)}<br><span class="muted xs">${esc(branchName(l.branch))} · ${esc(PNAME(l.prog))} · waiting ${rel(l.enq).replace(' ago', '')}</span></span>${direct || can('reassignment', 'C') ? `<button class="btn sm primary" data-act="mReassign" data-id="${l.id}">Assign</button>` : ''}</div>`).join('')}</div>`
        : emptyBox('Queue is empty', 'Every open lead has a counsellor.'),
    ) +
    card(
      'Leave & temporary reassignment',
      `<div class="list" style="margin:-14px">${
        S.staff
          .filter((s) => s.role === 'Counsellor' && inScope(s.branch) && s.leave)
          .map(
            (s) =>
              `<div><span><b>${esc(s.name)}</b> – ${esc(s.leave.reason)}<br><span class="muted xs">${fD(s.leave.from)} to ${fD(s.leave.to)} · cover: ${esc(staffName(s.backup))} · ${load(s.id).open} open lead(s)</span></span>${direct && load(s.id).open ? `<button class="btn sm" data-act="tempReassign" data-id="${s.id}">Move leads to cover</button>` : ''}</div>`,
          )
          .join('') || '<div class="empty">No counsellors on leave.</div>'
      }</div><p class="muted xs" style="margin:22px 0 0">Absence is set manually in Staff & User Management; automatic detection is not assumed.</p>`,
    ) +
    '</div><div style="height:14px"></div>' +
    card(
      'Reassignment requests',
      table(
        'rq',
        [
          { h: 'Request', f: (a) => a.id },
          { h: 'Summary', f: (a) => esc(a.summary) },
          { h: 'Reason', f: (a) => esc(a.reason) },
          { h: 'Status', f: (a) => stB(a.status) },
          { h: '', f: (a) => (a.status === 'Pending' ? apBtns(a) : '') },
        ],
        reqs,
        { all: 1, et: 'No requests' },
      ),
      { np: 1 },
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Assignment history (latest 12)',
      table(
        'ash',
        [
          { h: 'When', f: (r) => fDT(r.a.at) },
          { h: 'Lead', f: (r) => `<a ${lgo(r.l.id)}>${esc(r.l.student)}</a>` },
          { h: 'From → To', f: (r) => esc(staffName(r.a.from)) + ' → ' + esc(staffName(r.a.to)) },
          { h: 'Method', f: (r) => esc(r.a.how) },
          { h: 'By', f: (r) => esc(r.a.by) },
          { h: 'Reason', f: (r) => esc(r.a.reason) },
        ],
        hist.slice(0, 12),
        { all: 1 },
      ),
      { np: 1 },
    )
  );
};
ACT.tempReassign = (d) => {
  const s = S.staff.find((x) => x.id === d.id);
  const ls = S.leads.filter((l) => l.cslr === s.id && l.status === 'Open');
  ls.forEach((l) => reassign(l, s.backup, 'Temporary cover – ' + s.name + ' on leave', 'Temporary (leave)'));
  addAudit('Temporary reassignment', s.id, ls.length + ' lead(s) → ' + staffName(s.backup));
  render();
  toast(ls.length + ' lead(s) moved to ' + staffName(s.backup) + ' – history recorded', 'ok');
};
PAGES.slaBreaches = () => {
  const open = leadScope().filter((l) => l.status === 'Open');
  const st = ['On Track', 'Due Soon', 'Breached', 'Completed'].map((k) => ({
    l: k,
    v: leadScope().filter((l) => sla(l).s === k).length,
    c: { 'On Track': 'var(--c1)', 'Due Soon': 'var(--c5)', Breached: 'var(--c6)', Completed: 'var(--c4)' }[k],
    go: kgo('leads', { sla: k }, { preset: 'all' }),
  }));
  const rs = open
    .filter((l) => ['Breached', 'Due Soon'].includes(sla(l).s))
    .sort((a, b) => new Date(a.enq) - new Date(b.enq));
  const od = S.tasks.filter(
    (t) => t.status === 'Pending' && new Date(t.due) < NOW && leadById(t.lead) && inScope(leadById(t.lead).branch),
  );
  return (
    ph(
      'SLA Breaches',
      'First-call SLA ' +
        S.cfg.sla.mins +
        ' min · warning at ' +
        S.cfg.sla.warnPct +
        '% · escalation after ' +
        S.cfg.sla.escMins +
        ' min',
    ) +
    `<div class="grid g2">${card('First-call SLA status', donut(st))}${card('Escalation rule', `<p class="sm" style="margin:0">Uncalled leads past ${S.cfg.sla.escMins} min escalate to <b>${esc(S.cfg.sla.escTo)}</b>. Business-hours handling: <i>${esc(S.cfg.sla.biz)}</i>.</p>`)}</div><div style="height:14px"></div>` +
    card(
      'Uncalled leads (breached or due soon)',
      table(
        'sb',
        [
          { h: 'Lead', f: (l) => `<a ${lgo(l.id)}>${esc(l.student)}</a>` },
          { h: 'Branch · programme', f: (l) => esc(branchName(l.branch)) + ' · ' + esc(PNAME(l.prog)) },
          { h: 'Counsellor', f: (l) => (l.cslr ? esc(staffName(l.cslr)) : bdg('Unassigned', 'warn')) },
          { h: 'Enquiry', f: (l) => fDT(l.enq) },
          { h: 'Waiting', f: (l) => Math.round(sla(l).el || (NOW - new Date(l.enq)) / 6e4) + ' min' },
          { h: 'SLA', f: (l) => slaB(l) },
          {
            h: '',
            f: (l) =>
              can('leads', 'E')
                ? `<button class="btn sm" data-act="escalate" data-id="${l.id}"${l.esc ? ' disabled' : ''}>${l.esc ? 'Escalated' : 'Escalate'}</button>`
                : '',
          },
        ],
        rs,
        { all: 1, row: (l) => lgo(l.id), et: 'No SLA risk', ed: 'All uncalled leads are within SLA.' },
      ),
      { np: 1 },
    ) +
    '<div style="height:14px"></div>' +
    card('Overdue follow-ups (' + od.length + ')', table('sbo', taskCols(), od, { all: 1, et: 'None' }), { np: 1 })
  );
};
ACT.escalate = (d) => {
  const l = leadById(d.id);
  l.esc = true;
  addEv(l, 'crit', 'SLA escalation sent to ' + S.cfg.sla.escTo);
  notify(
    'sla',
    'crit',
    'Escalation: first call overdue for ' + l.student + ' (' + l.id + ')',
    { page: 'lead', id: l.id },
    ['Centre Administrator', 'Admissions Head', 'Management'],
    l.branch,
  );
  addAudit('SLA escalation', l.id, S.cfg.sla.escTo);
  render();
  toast('Escalated to ' + S.cfg.sla.escTo, 'ok');
};
