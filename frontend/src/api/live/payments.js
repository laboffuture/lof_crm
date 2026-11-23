/* Telr/Razorpay payment links and printable receipts. */
// Payments: hosted payment links + printable receipts
var _payCollect = PAGES.payCollect;
PAGES.payCollect = function (rt) {
  var h = _payCollect(rt);
  h = h.replace(
    /<div class="banner">[\s\S]*?<\/div>/,
    '<div class="banner">' +
      ic('wallet') +
      '<span>Record counter payments here, or send a secure payment link – <b>Telr</b> for AED branches, <b>Razorpay</b> for INR branches' +
      (modeOf('telr') === 'live' || modeOf('razorpay') === 'live' ? '' : ' (mock mode)') +
      '. Online payments are recorded automatically with a receipt.</span></div>',
  );
  if (S.payPick)
    h = h.replace(
      '<button class="btn primary" type="submit">Record payment (simulated)</button>',
      '<button class="btn primary" type="submit">Record payment</button><button class="btn" type="button" data-act="payLink" data-id="' +
        esc(S.payPick) +
        '">' +
        ic('link') +
        ' Send payment link</button>',
    );
  return h;
};
ACT.payLink = function (d) {
  var amt = document.querySelector('#payf [name=amt]');
  req('POST', '/payments/links', { enrollmentId: d.id, amount: amt ? +amt.value : undefined })
    .then(function (r) {
      openModal('plink', { link: r });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
MODALS.plink = function (m) {
  var l = m.link;
  return {
    title: 'Payment link ' + l.id,
    size: 'sm2',
    body:
      '<p class="sm">' +
      money(l.amount, l.currency) +
      ' via <b>' +
      (l.provider === 'telr' ? 'Telr' : 'Razorpay') +
      '</b>' +
      (l.mode === 'mock' ? ' <span class="sim">Mock</span>' : '') +
      '. The payment is recorded automatically when the parent pays.</p><div class="f"><label for="plurl">Link</label><input id="plurl" readonly value="' +
      esc(l.url) +
      '"></div>',
    foot:
      '<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="copy" data-v="' +
      esc(l.url) +
      '">Copy link</button><button class="btn" data-act="plSend" data-id="' +
      esc(l.id) +
      '" data-ch="Email">Send by e-mail</button><button class="btn primary" data-act="plSend" data-id="' +
      esc(l.id) +
      '" data-ch="WhatsApp">Send on WhatsApp</button>',
  };
};
ACT.plSend = function (d) {
  req('POST', '/payments/links/' + encodeURIComponent(d.id) + '/send', { channel: d.ch })
    .then(function () {
      closeModal();
      toast('Payment link sent by ' + d.ch, 'ok');
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.genReceipt = function (d) {
  var w = window.open('', '_blank');
  fetch(API + '/payments/' + encodeURIComponent(d.id) + '/receipt', { credentials: 'same-origin' })
    .then(function (r) {
      return r.text();
    })
    .then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (w) w.location = url;
      else location.href = url;
    })
    .catch(function (e) {
      if (w) w.close();
      toast(e.message, 'err');
    });
};
var _receipt = MODALS.receipt;
MODALS.receipt = function (m) {
  var x = _receipt(m);
  x.foot = x.foot.replace('Generate receipt (simulated)', 'Open printable receipt');
  x.body = x.body
    .replace('<span class="sim">Simulated</span>', '')
    .replace(
      'Prototype receipt – not a valid tax document. Finance linkage to ERPNext Accounts is pending integration.',
      'Receipt numbers are issued by the server. Payments are posted to ERPNext Accounts as Payment Entries.',
    );
  return x;
};
