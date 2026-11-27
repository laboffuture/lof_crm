/* Lead sources and campaigns, routing, lifecycle and SLA. */
/* sources */
CFG.sources = () =>
  card(
    'Lead sources',
    `<div class="list">${S.cfg.sources.map((s, i) => `<div><span><b>${esc(s.n)}</b><br><span class="muted xs">${esc(s.note)} ${['Website', 'Facebook', 'Instagram'].includes(s.n) ? '· integration ' + bdg('not connected – simulated', 'warn') : ''}</span></span><span class="row"><span class="muted xs">${s.en ? 'Lead creation enabled' : 'Disabled'}</span>${SW('src' + i, s.en, 'srcTog', 'data-i="' + i + '"')}</span></div>`).join('')}</div><div class="bd"><form class="row" data-submit="cfg_addsrc"><input name="n" placeholder="Add a future source, e.g. TikTok" aria-label="New source" style="min-width:min(100%,260px)"><button class="btn sm" type="submit">Add source</button></form></div>`,
    { np: 1 },
  ) +
  '<div style="height:14px"></div>' +
  card(
    'Campaign master',
    table(
      'cc',
      [
        { h: 'Campaign', f: (c) => `<b>${esc(c.n)}</b>` },
        { h: 'Source', f: (c) => esc(c.src) },
        { h: 'Start', f: (c) => fD(c.from) },
        { h: 'Status', f: (c) => bdg(c.active ? 'Active' : 'Inactive', c.active ? 'ok' : '') },
        {
          h: '',
          f: (c) =>
            `<button class="btn sm" data-act="campTog" data-n="${esc(c.n)}">${c.active ? 'Deactivate' : 'Activate'}</button>`,
        },
      ],
      S.cfg.camps,
      { all: 1 },
    ),
    { np: 1, act: `<button class="btn sm primary" data-act="mCamp">${ic('plus')} Add campaign</button>` },
  );
CHG.srcTog = (el) => {
  const s = S.cfg.sources[+el.dataset.i];
  s.en = el.checked;
  addAudit('Configuration changed', 'Lead sources', s.n + ' lead creation ' + (s.en ? 'enabled' : 'disabled'));
  render();
  toast(s.n + (s.en ? ' enabled' : ' disabled') + ' for lead creation', 'ok');
};
SUB.cfg_addsrc = (d, f) => {
  const n = (d.n || '').trim();
  if (!n) {
    toast('Enter a source name', 'warn');
    return;
  }
  if (S.cfg.sources.find((s) => s.n.toLowerCase() === n.toLowerCase())) {
    toast('That source already exists', 'warn');
    return;
  }
  S.cfg.sources.push({ n, en: true, note: 'Added in configuration' });
  if (!SRC_LIST.includes(n)) SRC_LIST.push(n);
  cfgSave('Lead source ' + n, 'added');
};
ACT.campTog = (d) => {
  const c = S.cfg.camps.find((x) => x.n === d.n);
  c.active = !c.active;
  addAudit('Configuration changed', 'Campaigns', c.n + ' → ' + (c.active ? 'active' : 'inactive'));
  render();
};
ACT.mCamp = () => openModal('camp', {});
MODALS.camp = () => ({
  title: 'Add campaign',
  form: 'camp',
  size: 'sm2',
  body: `<div class="fgrid">${F('Campaign name', 'n', { req: 1, full: 1 })}${F('Source', 'src', { opts: S.cfg.sources.map((s) => s.n), full: 1 })}${F('Start date', 'from', { t: 'date', v: TODAY, full: 1 })}</div>`,
});
SUB.camp = (d, f) => {
  if (!need(f, d, ['n'])) return;
  if (S.cfg.camps.find((c) => c.n.toLowerCase() === d.n.toLowerCase())) {
    setErr(f, 'n', 'Campaign already exists');
    return;
  }
  S.cfg.camps.push({ n: d.n, src: d.src, from: d.from, active: true });
  closeModal();
  cfgSave('Campaign ' + d.n, 'added');
};
/* routing */
CFG.routing = () => {
  const R = S.cfg.routing,
    cs = S.staff.filter((s) => s.role === 'Counsellor');
  return (
    card(
      'Lead assignment rules',
      cfgForm(
        'routing',
        `<div class="fgrid">${F('Assignment method', 'method', { v: R.method, opts: ['Workload-based', 'Round-robin'], help: 'Workload-based picks the lowest weighted load relative to the maximum; round-robin rotates among eligible counsellors.' })}${F('Absence handling', 'absence', { v: R.absence, opts: ['Skip counsellors who are on leave', 'Allow (ignore availability)'], help: 'Absence is set manually; automatic detection is not assumed.' })}${F('No counsellor available – notify', 'notifyNone', { v: R.notifyNone, opts: ['Admissions Head', 'Centre Administrator', 'System Administrator'] })}<div class="sec">Workload weights (open leads only)</div>${F('Hot', 'wHot', { t: 'number', min: 0, v: R.weights.Hot })}${F('Warm', 'wWarm', { t: 'number', min: 0, v: R.weights.Warm })}${F('Cold', 'wCold', { t: 'number', min: 0, v: R.weights.Cold })}${F('No Response', 'wNR', { t: 'number', min: 0, v: R.weights['No Response'] })}</div><div style="margin-top:12px">${swRow('Programme-based routing', 'pr', R.programRouting, 'Only counsellors who handle the lead’s programme are eligible')}${swRow('Branch eligibility', 'be', R.branchElig, 'Only counsellors in the selected branch are eligible')}${swRow('Notify when no counsellor is available', 'nt', R.notify, 'The lead stays in the actionable Unassigned queue')}</div><div class="sec" style="margin-top:16px">Maximum weighted workload per counsellor</div><div class="fgrid">${cs.map((s) => F(s.name + ' (' + s.branch + ')', 'mx_' + s.id, { t: 'number', min: 0, v: s.max })).join('')}</div><p class="muted xs">A lead stays an open lead until converted to an Opportunity; converted leads are excluded from workload.</p>`,
      ),
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Current workload view',
      table(
        'wlv',
        [
          { h: 'Counsellor', f: (s) => esc(s.name) },
          { h: 'Branch', f: (s) => s.branch },
          { h: 'Programmes', f: (s) => esc(s.programs.join(', ')) },
          { h: 'Availability', f: (s) => bdg(s.avail, s.avail === 'Available' ? 'ok' : 'warn') },
          { h: 'Open', f: (s) => load(s.id).open, r: 1 },
          {
            h: 'H / W / C',
            f: (s) => {
              const L = load(s.id);
              return L.Hot + ' / ' + L.Warm + ' / ' + L.Cold;
            },
            r: 1,
          },
          { h: 'Weighted', f: (s) => load(s.id).w, r: 1 },
          { h: 'Max', f: (s) => s.max, r: 1 },
          {
            h: 'Eligible',
            f: (s) =>
              s.avail !== 'Available'
                ? bdg('No – unavailable', 'warn')
                : load(s.id).w >= s.max
                  ? bdg('No – at limit', 'crit')
                  : bdg('Yes', 'ok'),
          },
        ],
        cs,
        { all: 1 },
      ),
      { np: 1 },
    )
  );
};
SUB.cfg_routing = (d, f) => {
  const w = { Hot: +d.wHot, Warm: +d.wWarm, Cold: +d.wCold, 'No Response': +d.wNR };
  if (Object.values(w).some((x) => isNaN(x) || x < 0)) {
    toast('Weights must be zero or more', 'err');
    return;
  }
  if (!(w.Hot >= w.Warm && w.Warm >= w.Cold)) {
    toast('Weights should not rise from Hot to Cold (Hot ≥ Warm ≥ Cold)', 'err');
    return;
  }
  const R = S.cfg.routing;
  const changed = R.method !== d.method;
  Object.assign(R, {
    method: d.method,
    absence: d.absence,
    notifyNone: d.notifyNone,
    programRouting: !!d.pr,
    branchElig: !!d.be,
    notify: !!d.nt,
  });
  Object.assign(R.weights, w);
  S.staff
    .filter((s) => s.role === 'Counsellor')
    .forEach((s) => {
      const v = +d['mx_' + s.id];
      if (!isNaN(v) && v >= 0) s.max = v;
    });
  cfgSave(
    'Lead assignment rules',
    (changed ? 'method → ' + d.method + '; ' : '') + 'weights H' + w.Hot + ' W' + w.Warm + ' C' + w.Cold,
  );
};
/* lifecycle */
CFG.lifecycle = () => {
  const L = S.cfg.life;
  return card(
    'Lead lifecycle',
    cfgForm(
      'life',
      `<div class="sec" style="margin-top:0">Lead categories (fixed by the requirements)</div><div class="chips">${CATS.map((c) => catB(c)).join(' ')}</div><div class="sec">Opportunity stages & probability</div><div class="fgrid">${L.oppStages.map((s, i) => F(s.n + (['Enrolled', 'Lost'].includes(s.n) ? ' (system stage)' : ''), 'sp' + i, { t: 'number', min: 0, max: 100, v: s.p, help: 'Probability %' })).join('')}</div><div class="fgrid" style="margin-top:8px">${F('Add stage (before Enrolled)', 'newStage', { ph: 'e.g. Trial Class' })}${F('Probability %', 'newProb', { t: 'number', min: 0, max: 100, v: 40 })}</div><div class="fgrid" style="margin-top:12px">${F('Lost reasons (one per line)', 'lost', { t: 'textarea', rows: 6, v: L.lostReasons.join('\n') })}${F('Not Interested reasons (one per line)', 'ni', { t: 'textarea', rows: 6, v: L.niReasons.join('\n') })}${F('No Response – maximum unanswered attempts', 'nr', { t: 'number', min: 1, max: 10, v: L.noRespMax, help: 'Lead closes automatically after this many unanswered attempts' })}</div>`,
    ),
  );
};
SUB.cfg_life = (d, f) => {
  const L = S.cfg.life;
  const lost = d.lost
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    ni = d.ni
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  if (!lost.length || !ni.length) {
    toast('Keep at least one reason in each list', 'err');
    return;
  }
  if (!(+d.nr >= 1)) {
    toast('Attempt limit must be at least 1', 'err');
    return;
  }
  L.oppStages.forEach((s, i) => {
    const v = +d['sp' + i];
    if (!isNaN(v)) s.p = Math.max(0, Math.min(100, v));
  });
  if (d.newStage && d.newStage.trim()) {
    if (L.oppStages.find((s) => s.n.toLowerCase() === d.newStage.trim().toLowerCase())) {
      toast('Stage already exists', 'err');
      return;
    }
    L.oppStages.splice(L.oppStages.length - 2, 0, { n: d.newStage.trim(), p: +d.newProb || 0 });
  }
  L.lostReasons = lost;
  L.niReasons = ni;
  L.noRespMax = +d.nr;
  cfgSave('Lead lifecycle', 'stages, reasons, No Response limit ' + d.nr);
};
/* sla */
CFG.sla = () => {
  const s = S.cfg.sla,
    c = S.cfg.cad;
  return card(
    'First-call SLA',
    cfgForm(
      'sla',
      `<div class="fgrid">${F('First-call SLA (minutes)', 'mins', { t: 'number', min: 1, v: s.mins, req: 1, help: 'Duration not stated as final in the requirements – needs business confirmation' })}${F('Warning threshold (% of SLA elapsed)', 'warnPct', { t: 'number', min: 1, max: 99, v: s.warnPct, req: 1 })}${F('Escalation after (minutes)', 'escMins', { t: 'number', min: 1, v: s.escMins, req: 1 })}${F('Escalation recipients', 'escTo', { v: s.escTo })}${F('Follow-up reminder (minutes before due)', 'remindMins', { t: 'number', min: 0, v: s.remindMins })}${F('Working hours / business calendar', 'biz', { v: s.biz, opts: ['Business-hours calendar not applied (pending business confirmation)', 'Working hours only (pending business confirmation)'] })}</div><div class="sec">Follow-up cadence by category</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Category</th><th>Initial follow-up (hours)</th><th>Repeat every (days)</th><th>For (days, 0 = ongoing)</th></tr></thead><tbody>${['Hot', 'Warm', 'Cold'].map((k) => `<tr><td>${catB(k)}</td><td><input type="number" min="1" name="h_${k}" value="${c[k].h}" aria-label="${k} initial hours"></td><td><input type="number" min="1" name="e_${k}" value="${c[k].every}" aria-label="${k} every days"></td><td><input type="number" min="0" name="f_${k}" value="${c[k].forD}" aria-label="${k} duration days"></td></tr>`).join('')}<tr><td>${catB('Not Interested')}</td><td colspan="3" class="muted sm">No follow-up. A standardised reason is mandatory.</td></tr><tr><td>${catB('No Response')}</td><td colspan="3" class="muted sm">Follows the original category; maximum ${S.cfg.life.noRespMax} unanswered attempts (Lead Lifecycle).</td></tr></tbody></table></div><p class="muted xs">Defaults from the requirements: Hot 24 h then every 2 days; Warm 48 h then every 5 days for 2 weeks; Cold 72 h then every 2 weeks for 1 month.</p>`,
    ),
  );
};
SUB.cfg_sla = (d, f) => {
  if (!need(f, d, ['mins', 'warnPct', 'escMins'])) return;
  if (+d.mins < 1 || +d.warnPct >= 100 || +d.warnPct < 1) {
    toast('SLA must be ≥1 minute and the warning threshold between 1 and 99%', 'err');
    return;
  }
  if (+d.escMins < +d.mins) {
    setErr(f, 'escMins', 'Escalation must be at or after the SLA time');
    return;
  }
  const s = S.cfg.sla;
  Object.assign(s, {
    mins: +d.mins,
    warnPct: +d.warnPct,
    escMins: +d.escMins,
    escTo: d.escTo,
    remindMins: +d.remindMins,
    biz: d.biz,
  });
  for (const k of ['Hot', 'Warm', 'Cold']) {
    const h = +d['h_' + k],
      e = +d['e_' + k],
      fo = +d['f_' + k];
    if (!(h > 0) || !(e > 0) || fo < 0 || isNaN(fo)) {
      toast('Check cadence values for ' + k, 'err');
      return;
    }
    S.cfg.cad[k] = { h, every: e, forD: fo };
  }
  cfgSave('SLA & follow-up rules', 'SLA ' + d.mins + ' min, warn ' + d.warnPct + '%');
};
