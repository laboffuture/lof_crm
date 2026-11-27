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

function lmsCallById(id) {
  return S.ms.find((call) => call.id === id) || S.checkoutLms?.find(({ call }) => call.id === id)?.call;
}
function lmsCallForEnrolment(enrollment) {
  const call = lmsCallById(enrollment.ms);
  if (call && call.status !== 'Awaiting Payment') return call;
  const checkout = S.checkoutLms?.find((entry) => entry.enrollmentId === enrollment.id);
  return checkout ? lmsCallById(checkout.call.id) : call;
}
function lmsCallsForView() {
  const checkout = new Map((S.checkoutLms || []).map((entry) => [entry.enrollmentId, entry]));
  for (const call of S.ms) {
    if (call.op !== 'cancel' && call.status !== 'Awaiting Payment') checkout.delete(call.enr);
  }
  const checkoutCallIds = new Set((S.checkoutLms || []).map(({ call }) => call.id));
  const displayCheckout = (entry) => ({
    ...lmsCallById(entry.call.id),
    enr: entry.enrollmentId,
    stu: entry.studentId,
    sandboxEnrollmentId: entry.call.enr,
  });
  const calls = [];
  for (const call of S.ms) {
    if (S.checkoutOrderIds?.has(call.enr) || checkoutCallIds.has(call.id)) continue;
    const entry = call.op !== 'cancel' && checkout.get(call.enr);
    calls.push(entry ? displayCheckout(entry) : call);
    if (entry) checkout.delete(call.enr);
  }
  return calls.concat(Array.from(checkout.values(), displayCheckout));
}
// The display can include verified checkout payments without changing documents sent by sync.
function paymentEnrolment(e) {
  const checkoutPaid = S.checkoutPaid?.get(e.id);
  if (!checkoutPaid) return e;
  const paid = r2(Math.min(e.total, (e.paid || 0) + checkoutPaid));
  return { ...e, paid, payStatus: paid >= e.total - 0.005 ? 'Paid' : 'Partially paid', sandboxPayment: true };
}
const usesUatSandboxCheckout = (e) => e?.uatCheckout === true;
function paymentRecordsForView() {
  const records = S.pay.filter((p) => !p.test || (S.paymentSandbox !== false && !enrById(p.enr)?.sandboxSource));
  return records.concat(S.checkoutPayments || []);
}
function feeFor(st, prog, branch, pkg) {
  return st.fees
    .filter(
      (f) =>
        f.active &&
        f.prog === prog &&
        f.branch === branch &&
        (!pkg || f.pkg === pkg) &&
        f.from <= TODAY &&
        (!f.to || f.to >= TODAY),
    )
    .sort(
      (a, b) =>
        String(b.from).localeCompare(String(a.from)) ||
        String(b.revisionAt || '').localeCompare(String(a.revisionAt || '')) ||
        String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
    )[0];
}
function calcFee(fee, disc, isNew) {
  const base = fee.amt,
    extra = isNew ? fee.extra.amt : 0;
  let d = 0;
  if (disc) {
    d = disc.type === '%' ? r2((base * disc.value) / 100) : Math.min(Number(disc.value), base);
  }
  const net = base - d + extra,
    taxPct = window.feeTaxPct ? window.feeTaxPct(fee) : fee.tax,
    tax = r2((net * taxPct) / 100);
  return { base, extra, disc: d, net, taxPct, tax, total: r2(net + tax) };
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
