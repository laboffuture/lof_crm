/* Payment terms and instalment schedules. */
/* ---------- payment terms & instalments ---------- */
const termById = (id) => (S.cfg.payTerms || []).find((t) => t.id === id);
const termName = (id) => (termById(id) || { name: 'Full payment' }).name;
function buildSched(term, total, date) {
  const sp = term && term.split && term.split.length ? term.split : [100];
  let acc = 0;
  return sp.map((p, i) => {
    const last = i === sp.length - 1,
      amt = last ? r2(total - acc) : r2((total * p) / 100);
    acc = r2(acc + amt);
    return { n: i + 1, due: addDays(date, i * ((term && term.gap) || 0)), pct: p, amt };
  });
}
function instStatus(e) {
  const term = termById(e.term),
    sch = e.sched && e.sched.length ? e.sched : buildSched(term, e.total, e.date),
    grace = term ? +term.grace || 0 : 0;
  let left = e.paid;
  return sch.map((x) => {
    const paid = r2(Math.min(Math.max(left, 0), x.amt));
    left = r2(left - paid);
    let st;
    if (paid >= x.amt - 0.005) st = 'Paid';
    else if (e.status === 'Withdrawn' || e.status === 'Completed') st = 'Closed';
    else if (addDays(x.due, grace) < TODAY) st = paid > 0 ? 'Overdue (part paid)' : 'Overdue';
    else if (x.due <= TODAY) st = paid > 0 ? 'Partly paid' : 'Due';
    else st = paid > 0 ? 'Partly paid' : 'Upcoming';
    return Object.assign({}, x, { paid, bal: r2(x.amt - paid), st, graceEnd: addDays(x.due, grace) });
  });
}
const overdueInsts = () =>
  S.enr
    .filter((e) => inScope(e.branch) && ['Active', 'On Hold'].includes(e.status))
    .flatMap((e) =>
      instStatus(e)
        .filter((i) => /^Overdue/.test(i.st))
        .map((i) => ({ e, i })),
    );
const INSTK = { Paid: 'ok', Due: 'warn', 'Partly paid': 'warn', Upcoming: 'info', Closed: '' };
const instB = (st) => bdg(st, st in INSTK ? INSTK[st] : 'crit');
function schedTable(rows, cur) {
  const st = rows.length && rows[0].st;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Instalment</th><th>Due</th><th class="r">Amount</th>${st ? '<th class="r">Paid</th><th>Status</th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr><td>${r.n} of ${rows.length} <span class="muted xs">(${r.pct}%)</span></td><td>${dayFmt(r.due)}</td><td class="r num">${money(r.amt, cur)}</td>${st ? `<td class="r num">${money(r.paid, cur)}</td><td>${instB(r.st)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function instSummary(e) {
  const r = instStatus(e),
    paid = r.filter((x) => x.st === 'Paid').length,
    od = r.find((x) => /^Overdue/.test(x.st)),
    nx = r.find((x) => x.st !== 'Paid' && x.st !== 'Closed');
  return `${paid}/${r.length} paid${od ? ' ' + bdg('Overdue', 'crit') : ''}<div class="muted xs">${esc(termName(e.term))}${nx && !od ? ' · next ' + dayFmt(nx.due) + ' · ' + money(nx.bal, e.cur) : ''}</div>`;
}
function instTile() {
  const o = overdueInsts();
  return kpi(
    'Overdue instalments',
    o.length,
    Math.round(o.reduce((a, x) => a + toAED(x.i.bal, x.e.cur), 0)).toLocaleString('en-US') + ' AED equivalent overdue',
    goA('reports', { rep: 'r22' }),
    o.length ? 'crit' : '',
  );
}
const termCheck = (t) => {
  const sp = t.split;
  if (!t.name || !t.name.trim()) return 'Enter a name';
  if (!sp.length || sp.some((x) => !(x > 0))) return 'Each instalment must be more than 0%';
  if (Math.abs(sp.reduce((a, b) => a + b, 0) - 100) > 0.001)
    return 'The split must add up to 100% (now ' + r2(sp.reduce((a, b) => a + b, 0)) + '%)';
  if (sp.length > 12) return 'At most 12 instalments';
  if (sp.length > 1 && !(t.gap >= 1)) return 'Days between instalments must be at least 1';
  if (!(t.minFirst >= 0 && t.minFirst <= 100)) return 'Minimum first instalment must be 0–100%';
  if (sp[0] < t.minFirst)
    return 'The first instalment (' + sp[0] + '%) is below the minimum first instalment (' + t.minFirst + '%)';
  if (!(t.grace >= 0)) return 'Grace days must be 0 or more';
  return '';
};
CFG.payTerms = () => {
  const T = S.cfg.payTerms || [];
  const sample = T.find((t) => t.id === (S.ptPrev || S.cfg.payTermDefault)) || T[0];
  return (
    card(
      'Payment terms',
      table(
        'cpt',
        [
          {
            h: 'Term',
            f: (t) =>
              `<b>${esc(t.name)}</b><div class="mono muted xs">${t.id}${t.id === S.cfg.payTermDefault ? ' · default' : ''}</div>`,
          },
          { h: 'Split', f: (t) => t.split.join(' / ') + ' %' },
          { h: 'Days between', f: (t) => (t.split.length > 1 ? t.gap : '—'), r: 1 },
          { h: 'Minimum first', f: (t) => t.minFirst + '%', r: 1 },
          { h: 'Grace days', f: (t) => t.grace, r: 1 },
          { h: 'Status', f: (t) => bdg(t.active ? 'Active' : 'Inactive', t.active ? 'ok' : '') },
          {
            h: '',
            f: (t) =>
              `<div class="row"><button class="btn sm" data-act="mPayTerm" data-id="${t.id}">Edit</button><button class="btn sm ghost" data-act="ptPrev" data-id="${t.id}">Preview</button></div>`,
          },
        ],
        T,
        { all: 1 },
      ),
      { np: 1, act: `<button class="btn sm primary" data-act="mPayTerm">${ic('plus')} Add payment term</button>` },
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Default and preview',
      cfgForm(
        'ptDefault',
        `<div class="fgrid">${F('Default term in the enrolment form', 'def', { v: S.cfg.payTermDefault, opts: T.filter((t) => t.active).map((t) => [t.id, t.name]) })}</div>`,
        { ok: 'Save default' },
      ) +
        (sample
          ? `<div class="sec">Example: ${esc(sample.name)} on AED 10,000.00 enrolled today</div>${schedTable(buildSched(sample, 10000, TODAY), 'AED')}<p class="muted xs">An instalment becomes overdue when it is unpaid ${sample.grace} day(s) after its due date. Payments are applied to the earliest instalment first.</p>`
          : ''),
    )
  );
};
ACT.ptPrev = (d) => {
  S.ptPrev = d.id;
  render();
};
ACT.mPayTerm = (d) => openModal('payTerm', { id: d.id });
MODALS.payTerm = (m) => {
  const t = m.id ? termById(m.id) : { name: '', split: [50, 50], gap: 30, minFirst: 50, grace: 7, active: true };
  return {
    title: m.id ? 'Edit payment term – ' + t.name : 'Add payment term',
    form: 'payTerm',
    ok: 'Save term',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Name', 'name', { v: t.name, req: 1 })}${F('Split (% per instalment)', 'split', { v: t.split.join(', '), req: 1, help: 'Comma separated, adds up to 100. Example: 40, 30, 30' })}${F('Days between instalments', 'gap', { t: 'number', min: 0, v: t.gap })}${F('Minimum first instalment (%)', 'minFirst', { t: 'number', min: 0, max: 100, v: t.minFirst })}${F('Grace days before overdue', 'grace', { t: 'number', min: 0, v: t.grace })}${F(
      'Status',
      'active',
      {
        v: t.active ? '1' : '0',
        opts: [
          ['1', 'Active'],
          ['0', 'Inactive'],
        ],
      },
    )}</div>`,
  };
};
SUB.payTerm = (d, f) => {
  if (!need(f, d, ['name', 'split'])) return;
  const t = {
    name: d.name.trim(),
    split: d.split
      .split(/[,\/ ]+/)
      .filter(Boolean)
      .map(Number),
    gap: +d.gap || 0,
    minFirst: +d.minFirst || 0,
    grace: +d.grace || 0,
    active: d.active === '1',
  };
  const p = termCheck(t);
  if (p) {
    setErr(f, 'split', p);
    return;
  }
  const T = S.cfg.payTerms;
  if (d.oid) {
    const o = termById(d.oid);
    if (!t.active && S.cfg.payTermDefault === o.id) {
      setErr(f, 'active', 'This is the default term – choose another default first');
      return;
    }
    Object.assign(o, t);
  } else {
    let n = T.length + 1;
    while (termById('PT' + n)) n++;
    T.push(Object.assign({ id: 'PT' + n }, t));
  }
  closeModal();
  cfgSave('Payment term ' + t.name, t.split.join('/') + ' every ' + t.gap + ' days, grace ' + t.grace);
};
SUB.cfg_ptDefault = (d) => {
  S.cfg.payTermDefault = d.def;
  cfgSave('Default payment term', termName(d.def));
};
