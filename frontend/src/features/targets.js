/* Counsellor monthly targets. */
/* ---------- counsellor targets ---------- */
function enrCslr(e) {
  if (e.cslr) return e.cslr;
  const o = e.opp && oppById(e.opp);
  return o ? o.cslr : null;
}
function tgtAch(c, m) {
  const es = S.enr.filter((e) => enrCslr(e) === c && e.date.startsWith(m) && e.status !== 'Withdrawn');
  const ls = S.leads.filter((l) => l.cslr === c && dayKey(l.enq).startsWith(m));
  return {
    enr: es.length,
    rev: r2(es.reduce((a, e) => a + e.total - e.tax, 0)),
    leads: ls.length,
    conv: ls.length ? Math.round((es.length / ls.length) * 100) : 0,
  };
}
const tgtFor = (c, m) => (S.cfg.targets || []).find((t) => t.c === c && t.m === m);
const pctN = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const achB = (a, t) => {
  const p = pctN(a, t);
  return bdg(p + '%', !t ? '' : p >= 100 ? 'ok' : p >= 60 ? 'warn' : 'crit');
};
CFG.targets = () => {
  const m = S.tgtMonth || curMonth(),
    T = S.cfg.targets || (S.cfg.targets = []);
  const cs = S.staff.filter((s) => s.role === 'Counsellor' && s.status === 'Active');
  const months = [...new Set(T.map((t) => t.m).concat([m, curMonth()]))].sort();
  const rows = cs
    .map((s) => {
      const t = tgtFor(s.id, m) || { enr: '', rev: '', conv: '' },
        a = tgtAch(s.id, m),
        cur = brCur(s.branch);
      return `<tr><td><b>${esc(s.name)}</b><div class="muted xs">${esc(branchName(s.branch))}</div></td><td><input name="e_${s.id}" type="number" min="0" step="1" value="${esc(t.enr)}" aria-label="Enrolment target ${esc(s.name)}" style="width:80px"></td><td><input name="r_${s.id}" type="number" min="0" step="1" value="${esc(t.rev)}" aria-label="Revenue target ${esc(s.name)}" style="width:110px"> <span class="muted xs">${cur}</span></td><td><input name="v_${s.id}" type="number" min="0" max="100" step="1" value="${esc(t.conv)}" aria-label="Conversion target ${esc(s.name)}" style="width:70px"> %</td><td class="r num">${a.enr} ${t.enr !== '' ? achB(a.enr, +t.enr) : ''}</td><td class="r num">${money(a.rev, cur)} ${t.rev !== '' ? achB(a.rev, +t.rev) : ''}</td><td class="r num">${a.conv}% <span class="muted xs">(${a.leads} leads)</span></td></tr>`;
    })
    .join('');
  const brs = S.branches
    .filter((b) => b.status === 'Operating')
    .map((b) => {
      const ts = cs
        .filter((s) => s.branch === b.id)
        .map((s) => tgtFor(s.id, m))
        .filter(Boolean);
      const se = ts.reduce((a, t) => a + (+t.enr || 0), 0),
        sr = ts.reduce((a, t) => a + (+t.rev || 0), 0);
      const ok = se === b.tAdm && sr === b.tRev;
      return [
        b.name,
        b.tAdm,
        se,
        money(b.tRev, b.cur),
        money(sr, b.cur),
        ok ? bdg('Matches', 'ok') : bdg((se < b.tAdm || sr < b.tRev ? 'Below' : 'Above') + ' branch target', 'warn'),
      ];
    });
  return (
    card(
      'Counsellor targets – ' + esc(monthName(m)),
      `<div class="tb" style="border:0;padding:0 0 12px"><select data-change="tgtMonth" aria-label="Month">${months.map((x) => `<option value="${x}"${x === m ? ' selected' : ''}>${esc(monthName(x))}</option>`).join('')}</select><button class="btn sm" type="button" data-act="tgtCopy">Copy from ${esc(monthName(monthAdd(m, -1)))}</button><button class="btn sm" type="button" data-act="tgtNext">${ic('plus')} Add ${esc(monthName(monthAdd(m, 1)))}</button><span class="muted xs" style="margin-left:auto">Revenue is in each counsellor’s branch currency, excluding tax.</span></div>` +
        cfgForm(
          'targets',
          `<input type="hidden" name="m" value="${m}"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Counsellor</th><th>Enrolments</th><th>Revenue</th><th>Conversion</th><th class="r">Enrolled</th><th class="r">Revenue booked</th><th class="r">Conversion</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted xs">Achievement: enrolments completed from the counsellor’s opportunities in the month (withdrawn excluded); revenue = their enrolment value excluding tax; conversion = enrolments ÷ leads assigned in the month.</p>`,
          { ok: 'Save targets' },
        ),
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Compared with branch targets',
      table(
        'tgb',
        [
          { h: 'Branch', f: (r) => esc(r[0]) },
          { h: 'Branch admissions target', f: (r) => r[1], r: 1 },
          { h: 'Sum of counsellor targets', f: (r) => r[2], r: 1 },
          { h: 'Branch revenue target', f: (r) => r[3], r: 1 },
          { h: 'Sum of counsellor revenue', f: (r) => r[4], r: 1 },
          { h: '', f: (r) => r[5] },
        ],
        brs,
        { all: 1 },
      ),
      { np: 1 },
    )
  );
};
CHG.tgtMonth = (el) => {
  S.tgtMonth = el.value;
  render();
};
SUB.cfg_targets = (d, f) => {
  const m = d.m,
    T = S.cfg.targets;
  const cs = S.staff.filter((s) => s.role === 'Counsellor' && s.status === 'Active');
  for (const s of cs) {
    const e = d['e_' + s.id],
      r = d['r_' + s.id],
      v = d['v_' + s.id];
    if (e === '' && r === '' && v === '') continue;
    if (!(+e >= 0) || !(+r >= 0) || !(+v >= 0) || +v > 100 || !Number.isInteger(+e)) {
      toast('Check the targets for ' + s.name + ': whole enrolments, revenue ≥ 0, conversion 0–100%', 'err');
      return;
    }
  }
  cs.forEach((s) => {
    const e = d['e_' + s.id],
      r = d['r_' + s.id],
      v = d['v_' + s.id];
    const i = T.findIndex((t) => t.m === m && t.c === s.id);
    if (e === '' && r === '' && v === '') {
      if (i >= 0) T.splice(i, 1);
      return;
    }
    const row = { m, c: s.id, enr: +e || 0, rev: +r || 0, conv: +v || 0 };
    if (i >= 0) T[i] = row;
    else T.push(row);
  });
  cfgSave('Counsellor targets', monthName(m));
};
ACT.tgtCopy = () => {
  const m = S.tgtMonth || curMonth(),
    pm = monthAdd(m, -1),
    T = S.cfg.targets;
  const src = T.filter((t) => t.m === pm);
  if (!src.length) {
    toast('No targets set for ' + monthName(pm), 'warn');
    return;
  }
  for (let i = T.length - 1; i >= 0; i--) if (T[i].m === m) T.splice(i, 1);
  src.forEach((t) => T.push(Object.assign({}, t, { m })));
  cfgSave('Counsellor targets', 'Copied ' + monthName(pm) + ' → ' + monthName(m));
};
ACT.tgtNext = () => {
  const m = S.tgtMonth || curMonth(),
    nm = monthAdd(m, 1),
    T = S.cfg.targets;
  if (!T.some((t) => t.m === nm)) T.filter((t) => t.m === m).forEach((t) => T.push(Object.assign({}, t, { m: nm })));
  S.tgtMonth = nm;
  cfgSave('Counsellor targets', 'Added ' + monthName(nm));
};
function tgtTile(u) {
  const m = curMonth(),
    t = tgtFor(u.id, m);
  if (!t) return kpi('My monthly target', '—', 'No target set for ' + monthName(m), goA('reports', { rep: 'r21' }));
  const a = tgtAch(u.id, m),
    cur = brCur(u.branch);
  return kpi(
    'My monthly target',
    a.enr + ' / ' + t.enr,
    'Enrolments · revenue ' +
      pctN(a.rev, t.rev) +
      '% of ' +
      money(t.rev, cur) +
      ' · conversion ' +
      a.conv +
      '% / ' +
      t.conv +
      '%',
    goA('reports', { rep: 'r21' }),
    a.enr >= t.enr ? '' : pctN(a.enr, t.enr) < 50 ? 'warn' : '',
  );
}
