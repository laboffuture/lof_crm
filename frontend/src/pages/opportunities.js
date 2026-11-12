/* Opportunity board/list, lost opportunities and opportunity record. */
/* ====== opportunities ====== */
const oppFee = (o) => {
  const f = feeFor(S, o.prog, o.branch, o.pkg);
  if (!f) return null;
  const c = calcFee(
    f,
    o.discount,
    !S.students.some((s) =>
      s.parents.some((p) => {
        const l = leadById(o.lead);
        return normPh(p.mobile) === normPh(l.phone);
      }),
    ),
  );
  return { f, c };
};
const oppProb = (o) => (S.cfg.life.oppStages.find((s) => s.n === o.stage) || { p: 0 }).p;
const OGO = (o) => goA('opp', { id: o.id });
PAGES.opps = () => {
  const os = visOpps(),
    v = S.oppView || 'board';
  const q = leadScope().filter((l) => l.stage === 'Qualified' && l.status === 'Open');
  const cols = S.cfg.life.oppStages.map((s) => s.n);
  const g = (c) => os.filter((o) => o.stage === c);
  const board = `<div class="kb">${[
    `<div class="kcol"><h4><span>Qualified leads</span><span>${q.length}</span></h4><div class="kl">${q.map((l) => `<div class="kc" ${can('opportunities', 'C') ? `draggable="true" data-drag="L:${l.id}"` : ''} ${lgo(l.id)}><div class="n">${esc(l.student)}</div><div class="muted sm">${esc(PNAME(l.prog))} · ${esc(branchName(l.branch))}</div><div class="row" style="margin-top:6px">${catB(l.cat)}<button class="btn sm" data-act="startConvert" data-id="${l.id}">Convert</button></div></div>`).join('') || '<div class="muted xs" style="padding:8px">No qualified leads waiting</div>'}</div></div>`,
  ]
    .concat(
      cols.map(
        (c) =>
          `<div class="kcol" data-drop="oppDrop" data-to="${c}"><h4><span>${c}${c === 'Enrolled' || c === 'Lost' ? '' : ' · ' + S.cfg.life.oppStages.find((s) => s.n === c).p + '%'}</span><span>${g(c).length}</span></h4><div class="kl">${
            g(c)
              .map((o) => {
                const r = oppFee(o);
                return `<div class="kc" ${!['Enrolled', 'Lost'].includes(o.stage) && can('opportunities', 'E') ? `draggable="true" data-drag="${o.id}"` : ''} ${OGO(o)}><div class="n">${esc(o.student)}</div><div class="muted sm">${esc(PNAME(o.prog))} · ${esc(branchName(o.branch))}</div><div class="row" style="margin-top:6px"><b class="num">${r ? money(r.c.total, r.f.cur) : '—'}</b>${o.discount ? bdg(o.discount.kind === 'predefined' ? 'Discount ' + o.discount.value + (o.discount.type === '%' ? '%' : '') : 'Exceptional ' + o.discount.value + (o.discount.type === '%' ? '%' : ''), 'ok') : ''}${o.discReq ? bdg('Discount pending', 'warn') : ''}${o.decision ? bdg(o.decision, o.decision === 'Accepted' ? 'ok' : 'warn') : ''}</div><div class="muted xs" style="margin-top:6px">${esc(staffName(o.cslr))} · ${esc(o.next || o.lost || '—')}</div></div>`;
              })
              .join('') || '<div class="muted xs" style="padding:8px">Empty</div>'
          }</div></div>`,
      ),
    )
    .join(
      '',
    )}</div><p class="muted xs">Drag between stages. Enrolling requires the enrolment form; Lost needs a reason. Stages and probabilities are configured under Lead Lifecycle.</p>`;
  const tbl = card(
    '',
    table(
      'opps',
      [
        { h: 'Opportunity', f: (o) => `<span class="mono">${o.id}</span>`, s: (o) => o.id },
        { h: 'Prospect', f: (o) => `<b>${esc(o.student)}</b>`, s: (o) => o.student },
        { h: 'Parent', f: (o) => esc(o.parent) },
        { h: 'Branch', f: (o) => esc(branchName(o.branch)) },
        { h: 'Programme', f: (o) => esc(PNAME(o.prog)) },
        { h: 'Counsellor', f: (o) => esc(staffName(o.cslr)) },
        {
          h: 'Expected fee',
          f: (o) => {
            const r = oppFee(o);
            return r ? money(r.c.total, r.f.cur) : '—';
          },
          r: 1,
        },
        {
          h: 'Discount',
          f: (o) =>
            o.discount
              ? esc(o.discount.name) + ' ' + o.discount.value + (o.discount.type === '%' ? '%' : '')
              : o.discReq
                ? bdg('Pending', 'warn')
                : '—',
        },
        { h: 'Exp. enrolment', f: (o) => fD(o.exp) },
        {
          h: 'Stage',
          f: (o) => bdg(o.stage, { Enrolled: 'ok', Lost: 'crit', 'Admission Decision': 'warn' }[o.stage] || 'info'),
          s: (o) => o.stage,
        },
        { h: 'Probability', f: (o) => oppProb(o) + '%' },
        { h: 'Next action', f: (o) => esc(o.next || o.lost) },
      ],
      os,
      { ps: 12, row: OGO },
    ),
    { np: 1 },
  );
  return (
    ph(
      'Opportunities',
      'Sales pipeline: Lead → Qualified → Opportunity → Admission Decision → Enrol / Lost',
      `<span class="seg"><a class="${v === 'board' ? 'on' : ''}" data-act="oppView" data-v="board" tabindex="0">Pipeline</a><a class="${v === 'table' ? 'on' : ''}" data-act="oppView" data-v="table" tabindex="0">Table</a></span>`,
    ) + (v === 'board' ? board : tbl)
  );
};
ACT.oppView = (d) => {
  S.oppView = d.v;
  render();
};
ACT.oppDrop = (d) => {
  if (d.id.startsWith('L:')) {
    const l = leadById(d.id.slice(2));
    if (d.to !== 'Opportunity') {
      toast('Convert a qualified lead by dropping it on Opportunity', 'warn');
      return;
    }
    ACT.startConvert({ id: l.id });
    return;
  }
  const o = oppById(d.id);
  if (!can('opportunities', 'E') || ['Enrolled', 'Lost'].includes(o.stage)) return;
  if (d.to === o.stage) return;
  if (d.to === 'Lost') return openModal('oppLost', { id: o.id });
  if (d.to === 'Enrolled') {
    toast('Complete the enrolment form to mark as enrolled', 'warn');
    return ACT.enrollOpp({ id: o.id });
  }
  o.stage = d.to;
  o.hist.push({ at: nowIso(), by: me().name, text: 'Stage changed to ' + d.to });
  addAudit('Opportunity stage changed', o.id, '→ ' + d.to);
  render();
  toast('Moved to ' + d.to, 'ok');
};
PAGES.lostOpps = () => {
  const os = S.opps.filter((o) => o.stage === 'Lost' && inScope(o.branch));
  const ll = leadScope().filter((l) => l.status === 'Lost');
  return (
    ph('Lost Opportunities', 'Opportunities and leads lost, with mandatory reasons') +
    card(
      'Lost opportunities',
      table(
        'lo',
        [
          { h: 'Opportunity', f: (o) => o.id },
          { h: 'Prospect', f: (o) => esc(o.student) },
          { h: 'Programme', f: (o) => esc(PNAME(o.prog)) },
          { h: 'Branch', f: (o) => esc(branchName(o.branch)) },
          { h: 'Counsellor', f: (o) => esc(staffName(o.cslr)) },
          { h: 'Lost reason', f: (o) => esc(o.lost) },
        ],
        os,
        { all: 1, row: OGO, et: 'No lost opportunities' },
      ),
      { np: 1 },
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Leads lost before conversion',
      table(
        'll',
        [
          { h: 'Lead', f: (l) => `<a ${lgo(l.id)}>${esc(l.student)}</a>` },
          { h: 'Programme', f: (l) => esc(PNAME(l.prog)) },
          { h: 'Branch', f: (l) => esc(branchName(l.branch)) },
          { h: 'Counsellor', f: (l) => esc(staffName(l.cslr)) },
          { h: 'Reason', f: (l) => esc(l.lostReason) },
        ],
        ll,
        { all: 1, et: 'None' },
      ),
      { np: 1 },
    )
  );
};
PAGES.opp = (rt) => {
  const o = oppById(rt.id);
  if (!o || !inScope(o.branch)) return ph('Opportunity not found', '');
  const l = leadById(o.lead),
    r = oppFee(o),
    E = can('opportunities', 'E') && !['Enrolled', 'Lost'].includes(o.stage),
    stu = o.stu && stuById(o.stu);
  const avail = S.discounts.filter(
    (d) =>
      d.active &&
      (d.branches === 'All' ||
        (d.branches === 'UAE') === (S.branches.find((b) => b.id === o.branch).country === 'UAE')),
  );
  const fee = r
    ? `${feeBox(r.f, o.discount, r.c.extra > 0)}<p class="muted xs">Fee master: ${r.f.id} · effective ${fD(r.f.from)}. Master changes never rewrite completed enrolments or payments.</p>`
    : '<p class="muted">No active fee record for this branch/programme/package.</p>';
  const dsc = E
    ? `<div class="sec" style="margin-top:12px">Discount</div>${o.discount ? `<div class="row">${bdg(o.discount.name + ' – ' + o.discount.value + (o.discount.type === '%' ? '%' : ''), 'ok')}<span class="muted xs">${o.discount.kind === 'predefined' ? 'Predefined – no approval needed' : 'Exceptional – approved ' + esc(o.discount.ref)}</span><button class="btn sm" data-act="rmDisc" data-id="${o.id}">Remove</button></div>` : o.discReq ? `<div class="banner">Exceptional discount ${o.discReq} is awaiting Management approval. It is not applied to the fee yet.</div>` : `<div class="row"><select id="pdsel" aria-label="Predefined discount"><option value="">Select predefined discount</option>${avail.map((d) => `<option value="${d.id}">${esc(d.name)} – ${d.value}${d.type === '%' ? '%' : ' flat'} (${esc(d.elig)})</option>`).join('')}</select><button class="btn sm" data-act="applyPD" data-id="${o.id}">Apply</button><button class="btn sm" data-act="mDisc" data-id="${o.id}">Request exceptional discount</button></div><p class="muted xs">Predefined discounts apply immediately. Custom discounts need Management approval and are not applied until approved.</p>`}`
    : '';
  const act = E
    ? `<button class="btn" data-act="mOppStage" data-id="${o.id}">Update stage</button><button class="btn" data-act="mDecision" data-id="${o.id}">Record admission decision</button><button class="btn" data-act="mFu" data-id="${o.lead}">Schedule follow-up</button>${can('enrollments', 'C') ? `<button class="btn primary" data-act="enrollOpp" data-id="${o.id}">Enrol student</button>` : '<span class="muted xs">Enrolment is completed by Centre Administrator / Reception / Admissions Head</span>'}<button class="btn danger" data-act="mOppLost" data-id="${o.id}">Mark as lost</button>`
    : '';
  return `<div class="muted sm" style="margin-bottom:8px"><a ${goA('opps')}>Opportunities</a> / ${o.id}</div><div class="sum"><div class="it"><small>Opportunity</small><b style="font-size:16px">${esc(o.student)}</b> <span class="mono muted">${o.id}</span></div><div class="it"><small>Stage</small>${bdg(o.stage, { Enrolled: 'ok', Lost: 'crit', 'Admission Decision': 'warn' }[o.stage] || 'info')} <span class="muted xs">${oppProb(o)}%</span></div><div class="it"><small>Decision</small>${o.decision ? bdg(o.decision, o.decision === 'Accepted' ? 'ok' : 'warn') : 'Pending'}</div><div class="it"><small>Programme</small>${esc(PNAME(o.prog))} · ${esc(o.pkg)}</div><div class="it"><small>Branch</small>${esc(branchName(o.branch))}</div><div class="it"><small>Counsellor</small>${esc(staffName(o.cslr))}</div><div class="it"><small>Parent</small>${esc(o.parent)}</div><div class="it"><small>Exp. enrolment</small>${fD(o.exp)}</div></div><div class="row" style="margin-bottom:14px">${act}</div><div class="grid g2">${card('Programme & fee', fee + dsc)}${card(
    'Details',
    dl([
      ['Linked lead', `<a ${lgo(l.id)}>${l.id}</a>`],
      ['Next action', esc(o.next)],
      [
        'Outcome',
        o.stage === 'Enrolled'
          ? 'Enrolled' + (stu ? ' – <a ' + sgo(stu.id) + '>' + stu.id + '</a>' : '')
          : o.stage === 'Lost'
            ? 'Lost'
            : 'In progress',
      ],
      ['Lost reason', esc(o.lost)],
    ]),
  )}${card('Activity & decision history', timeline(o.hist.map((h) => ({ at: h.at, text: h.text, by: h.by, type: 'sys' }))))}</div>`;
};
Object.assign(ACT, {
  mOppStage: (d) => openModal('oppStage', { id: d.id }),
  mDecision: (d) => openModal('decision', { id: d.id }),
  mOppLost: (d) => openModal('oppLost', { id: d.id }),
  mDisc: (d) => openModal('discReq', { opp: d.id }),
  rmDisc(d) {
    const o = oppById(d.id);
    o.hist.push({ at: nowIso(), by: me().name, text: 'Discount removed: ' + o.discount.name });
    addAudit('Discount removed', o.id, o.discount.name);
    o.discount = null;
    render();
    toast('Discount removed', 'ok');
  },
  applyPD(d) {
    const o = oppById(d.id),
      v = $('#pdsel').value;
    if (!v) {
      toast('Select a discount first', 'warn');
      return;
    }
    const pd = S.discounts.find((x) => x.id === v);
    o.discount = { kind: 'predefined', ref: pd.id, name: pd.name, type: pd.type, value: pd.value };
    o.hist.push({
      at: nowIso(),
      by: me().name,
      text:
        'Predefined discount applied: ' +
        pd.name +
        ' (' +
        pd.value +
        (pd.type === '%' ? '%' : ' flat') +
        ') – no approval required',
    });
    addAudit('Predefined discount applied', o.id, pd.name);
    render();
    toast('Predefined discount applied – no approval required', 'ok');
  },
});
MODALS.oppStage = (m) => {
  const o = oppById(m.id);
  return {
    title: 'Update stage – ' + o.student,
    form: 'oppStage',
    ok: 'Update',
    size: 'sm2',
    body: `<input type="hidden" name="id" value="${o.id}"><div class="fgrid">${F('Stage', 'stage', { opts: S.cfg.life.oppStages.map((s) => s.n).filter((n) => !['Enrolled', 'Lost'].includes(n)), v: o.stage, full: 1 })}</div><p class="muted sm">Enrolled is set only by completing the enrolment form. Lost requires a reason.</p>`,
  };
};
SUB.oppStage = (d) => {
  const o = oppById(d.id);
  o.stage = d.stage;
  o.hist.push({ at: nowIso(), by: me().name, text: 'Stage changed to ' + d.stage });
  addAudit('Opportunity stage changed', o.id, '→ ' + d.stage);
  closeModal();
  toast('Stage updated', 'ok');
};
MODALS.decision = (m) => {
  const o = oppById(m.id);
  return {
    title: 'Admission decision – ' + o.student,
    form: 'decision',
    ok: 'Record decision',
    body: `<input type="hidden" name="id" value="${o.id}"><div class="fgrid">${F('Decision', 'dec', { opts: ['Accepted', 'Waitlisted', 'Declined'], req: 1, blank: 'Select decision' })}${F('Remarks', 'rem', { t: 'textarea', full: 1 })}</div>`,
  };
};
SUB.decision = (d, f) => {
  if (!need(f, d, ['dec'])) return;
  const o = oppById(d.id);
  if (d.dec === 'Declined') {
    o.stage = 'Lost';
    o.lost = 'Declined by admissions';
    o.decision = 'Declined';
    o.next = '';
  } else {
    o.decision = d.dec;
    o.stage = 'Admission Decision';
    o.next = d.dec === 'Accepted' ? 'Collect payment and enrol' : 'Review again when seat is available';
  }
  o.hist.push({ at: nowIso(), by: me().name, text: 'Admission decision: ' + d.dec + (d.rem ? ' – ' + d.rem : '') });
  addAudit('Admission decision', o.id, d.dec);
  closeModal();
  toast('Decision recorded: ' + d.dec, 'ok');
};
MODALS.oppLost = (m) => {
  const o = oppById(m.id);
  return {
    title: 'Mark opportunity lost – ' + o.student,
    form: 'oppLost',
    ok: 'Mark as lost',
    danger: 1,
    body: `<input type="hidden" name="id" value="${o.id}"><div class="fgrid">${F('Lost reason', 'reason', { opts: S.cfg.life.lostReasons, blank: 'Select reason', req: 1, full: 1 })}${F('Remarks', 'rem', { t: 'textarea', full: 1 })}</div>`,
  };
};
SUB.oppLost = (d, f) => {
  if (!need(f, d, ['reason'])) return;
  const o = oppById(d.id);
  o.stage = 'Lost';
  o.lost = d.reason;
  o.next = '';
  o.hist.push({ at: nowIso(), by: me().name, text: 'Marked lost – ' + d.reason });
  addEv(leadById(o.lead), 'warn', 'Opportunity ' + o.id + ' marked lost – ' + d.reason);
  addAudit('Opportunity lost', o.id, d.reason);
  closeModal();
  toast('Opportunity marked lost', 'ok');
};
