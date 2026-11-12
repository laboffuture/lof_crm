/* Computed values: SLA status, fee calculation, eligibility. */
/* ====== derived ====== */
const lw = (cat) => {
  const w = S.cfg.routing.weights[cat];
  return w == null ? 1 : w;
};
function load(cid) {
  const ls = S.leads.filter((l) => l.cslr === cid && l.status === 'Open');
  const o = { open: ls.length, Hot: 0, Warm: 0, Cold: 0, other: 0, w: 0 };
  ls.forEach((l) => {
    if (o[l.cat] != null) o[l.cat]++;
    else o.other++;
    o.w += lw(l.cat);
  });
  return o;
}
function sla(l) {
  if (l.status !== 'Open' && !l.fc && l.status !== 'Converted') return { s: '—', k: '' };
  if (l.fc) {
    const m = Math.round((new Date(l.fc) - new Date(l.enq)) / 6e4);
    return { s: 'Completed', k: 'ok', late: m > S.cfg.sla.mins, mins: m };
  }
  const el = (NOW - new Date(l.enq)) / 6e4,
    lim = S.cfg.sla.mins;
  if (el >= lim) return { s: 'Breached', k: 'crit', over: Math.round(el - lim), el };
  if (el >= (lim * S.cfg.sla.warnPct) / 100) return { s: 'Due Soon', k: 'warn', el };
  return { s: 'On Track', k: 'info', el };
}
function eligibility(st, branch, prog, cat) {
  return S.staff
    .filter((s) => s.role === 'Counsellor' && s.status === 'Active')
    .map((s) => {
      const R = S.cfg.routing,
        L = load(s.id),
        w = lw(cat);
      let why = '';
      if (R.branchElig && s.branch !== branch) why = 'Different branch';
      else if (R.programRouting && !s.programs.includes(prog)) why = 'Programme not handled';
      else if (s.avail !== 'Available' && R.absence.indexOf('Skip') === 0) why = 'On leave / unavailable';
      else if (L.w + w > s.max) why = 'Workload limit (' + L.w + ' + ' + w + ' > ' + s.max + ')';
      return { s, L, why };
    });
}
function routeLead(branch, prog, cat) {
  const rows = eligibility(S, branch, prog, cat);
  const ok = rows.filter((r) => !r.why).sort((a, b) => (a.s.id < b.s.id ? -1 : 1));
  let pick = null;
  if (ok.length) {
    if (S.cfg.routing.method === 'Round-robin') {
      const last = S.rrLast[branch] || '';
      pick = ok.find((r) => r.s.id > last) || ok[0];
      S.rrLast[branch] = pick.s.id;
    } else pick = ok.slice().sort((a, b) => a.L.w / a.s.max - b.L.w / b.s.max || a.L.w - b.L.w)[0];
  }
  return { pick: pick && pick.s, rows };
}
function leadScope() {
  return S.leads.filter((l) => inScope(l.branch));
}
function addAudit(act, ref, det, by) {
  S.audit.unshift({ id: 'AU' + S.seq.audit++, at: nowIso(), by: by || me().name, act, ref, det });
}
function notify(type, sev, text, route, roles, branch, cslr) {
  S.notifs.unshift({ id: 'N' + S.seq.notif++, type, sev, text, at: nowIso(), read: false, route, roles, branch, cslr });
}
function visNotifs() {
  const u = me();
  return S.notifs.filter(
    (n) =>
      (!n.roles || n.roles.includes(u.role)) &&
      (!n.branch || inScope(n.branch)) &&
      (!n.cslr || u.role !== 'Counsellor' || n.cslr === u.id),
  );
}
const leadById = (id) => S.leads.find((l) => l.id === id),
  oppById = (id) => S.opps.find((o) => o.id === id),
  stuById = (id) => S.students.find((s) => s.id === id),
  enrById = (id) => S.enr.find((e) => e.id === id);
const age = (dob) => {
  const d = new Date(dob),
    n = NOW;
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
};
const toAED = (a, c) => a * (S.fx[c] || 1);
const addEv = (l, type, text, by) => {
  l.events.push({ at: nowIso(), type, text, by: by || me().name });
  l.last = nowIso();
};
