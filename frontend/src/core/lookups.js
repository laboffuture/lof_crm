/* Find records by id and permission/branch-scope checks. */
/* ====== lookups ====== */
const staffName = (id) => (id ? ((S && S.staff.find((s) => s.id === id)) || { name: id }).name : 'Unassigned');
const branchName = (id) =>
  (S ? S.branches.find((b) => b.id === id) : null) ? S.branches.find((b) => b.id === id).name : id;
const me = () => S.staff.find((s) => s.id === S.user);
const roleScope = (u) =>
  u.role === 'Management' || u.role === 'System Administrator'
    ? S.branches.map((b) => b.id)
    : S.scope[u.id] || [u.branch];
const myScope = () => roleScope(me());
let inScope = (b) => myScope().includes(b);
const can = (res, cap) => ((S.perms[res] || {})[me().role] || '').includes(cap);
function feeFor(st, prog, branch, pkg) {
  return st.fees.find(
    (f) =>
      f.active &&
      f.prog === prog &&
      f.branch === branch &&
      (!pkg || f.pkg === pkg) &&
      f.from <= TODAY &&
      (!f.to || f.to >= TODAY),
  );
}
function calcFee(fee, disc, isNew) {
  const base = fee.amt,
    extra = isNew ? fee.extra.amt : 0;
  let d = 0;
  if (disc) {
    d = disc.type === '%' ? r2((base * disc.value) / 100) : Math.min(Number(disc.value), base);
  }
  const net = base - d + extra,
    tax = r2((net * fee.tax) / 100);
  return { base, extra, disc: d, net, tax, total: r2(net + tax) };
}
function addPay(st, e, amt, method, ref, date, by) {
  const k = e.branch;
  st.seq.rc[k] = (st.seq.rc[k] || 0) + 1;
  const p = {
    id: 'PY-26-' + String(st.pay.length + 1).padStart(4, '0'),
    enr: e.id,
    stu: e.stu,
    amt,
    cur: e.cur,
    method,
    ref,
    at: date.length <= 10 ? date + 'T11:00:00+04:00' : date,
    rc: 'RC-' + k + '-26-' + String(st.seq.rc[k]).padStart(4, '0'),
    status: 'Recorded (simulated)',
    by,
    branch: e.branch,
  };
  st.pay.push(p);
  e.paid = r2(e.paid + amt);
  e.payStatus = e.paid >= e.total - 0.005 ? 'Paid' : e.paid > 0 ? 'Partially paid' : 'Unpaid';
  return p;
}
