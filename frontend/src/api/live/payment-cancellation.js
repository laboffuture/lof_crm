// ---------------- Transaction cancellation
// A payment taken by mistake is cancelled, never deleted: two questions (parent's knowledge, reason), then a final
// "cannot be undone" confirmation. The receipt number stays, marked Cancelled; the amount leaves every total.
function canCancelPay() {
  return can('payments', 'C') || can('payments', 'E');
}
window.payCancelBtn = function (p) {
  return p && !p.test && p.status !== 'Cancelled' && canCancelPay()
    ? '<button class="btn sm danger" data-act="payCancel" data-id="' + esc(p.id) + '">Cancel payment</button>'
    : '';
};
ACT.payCancel = function (d) {
  closeModal();
  openModal('payCancel', { id: d.id, step: 1 });
};
MODALS.payCancel = function (m) {
  var p = S.pay.find(function (x) {
    return x.id === m.id;
  });
  if (!p || p.test) return { title: 'Payment not found', body: '' };
  var s = stuById(p.stu),
    who = s ? s.first + ' ' + s.last : p.stu;
  var summary =
    '<div class="card" style="margin-bottom:12px"><div class="bd">' +
    dl([
      ['Receipt', '<span class="mono">' + esc(p.rc) + '</span>'],
      ['Student', esc(who)],
      ['Amount', '<b>' + money(p.amt, p.cur) + '</b>'],
      ['Paid', esc(fDT(p.at)) + ' · ' + esc(p.method) + (p.ref && p.ref !== '—' ? ' · ' + esc(p.ref) : '')],
      ['Enrolment', '<span class="mono">' + esc(p.enr) + '</span>'],
    ]) +
    '</div></div>';
  if (m.step === 2) {
    return {
      title: 'Cancel this transaction?',
      size: 'sm2',
      body:
        summary +
        '<div class="banner" style="background:var(--crit-bg,#fdecec);color:var(--crit,#b42318);display:block"><b>This cannot be undone.</b> Once cancelled, the transaction cannot be restored. Receipt <span class="mono">' +
        esc(p.rc) +
        '</span> stays in the records marked Cancelled, and ' +
        money(p.amt, p.cur) +
        ' is removed from the paid amount and from all totals.</div>' +
        '<p class="sm" style="margin-top:10px">With the parent’s knowledge: <b>' +
        esc(m.aware) +
        '</b><br>Reason: ' +
        esc(m.reason) +
        '</p>',
      foot: '<button class="btn" data-act="closeModal">Don’t cancel</button><button class="btn danger" data-act="payCancelGo">OK, cancel the transaction</button>',
    };
  }
  var radio = function (v) {
    return (
      '<label style="display:inline-flex;gap:6px;align-items:center;margin-right:18px"><input type="radio" name="aware" value="' +
      v +
      '"' +
      (m.aware === v ? ' checked' : '') +
      '> ' +
      v +
      '</label>'
    );
  };
  return {
    title: 'Cancel transaction ' + p.rc,
    form: 'payCancel',
    ok: 'Continue',
    danger: 1,
    size: 'sm2',
    foot: '<button class="btn" data-act="closeModal">Keep the transaction</button><button class="btn danger" type="submit" form="mform">Continue</button>',
    body:
      summary +
      '<input type="hidden" name="id" value="' +
      esc(p.id) +
      '">' +
      '<div class="f"><label>1. Is this transaction being cancelled with the parent’s knowledge? *</label><div style="padding:6px 0">' +
      radio('Yes') +
      radio('No') +
      '</div></div>' +
      '<div class="f"><label for="pcReason">2. Reason for the cancellation *</label><textarea id="pcReason" name="reason" rows="4" maxlength="500" placeholder="e.g. Wrong course selected – parent wanted Robotics, not AI">' +
      esc(m.reason || '') +
      '</textarea></div>' +
      '<p class="muted xs">Refunds are handled separately.</p>',
  };
};
SUB.payCancel = function (d) {
  var reason = String(d.reason || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (d.aware !== 'Yes' && d.aware !== 'No') {
    toast('Answer question 1: is the parent aware of the cancellation?', 'err');
    return;
  }
  if (reason.length < 10) {
    toast('Describe the reason for the cancellation (at least 10 characters)', 'err');
    return;
  }
  openModal('payCancel', { id: d.id, step: 2, aware: d.aware, reason: reason });
};
ACT.payCancelGo = function () {
  var m = S.modal || {};
  var btn = document.querySelector('[data-act="payCancelGo"]');
  if (btn) btn.disabled = true;
  req('POST', '/payments/' + encodeURIComponent(m.id) + '/cancel', {
    parentAware: m.aware,
    reason: m.reason,
    confirm: true,
  })
    .then(function (r) {
      mergeDocs([{ coll: 'pay', doc: r.payment }].concat(r.enrollment ? [{ coll: 'enr', doc: r.enrollment }] : []));
      closeModal();
      toast('Transaction ' + r.payment.rc + ' cancelled', 'ok');
      render();
    })
    .catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'err');
    });
};
