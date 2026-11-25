/* Hosted payment links and printable receipts. */
// Payments: hosted payment links + printable receipts
var _payCollect = PAGES.payCollect;
var creatingPaymentLink = false;
PAGES.payCollect = function (rt) {
  var h = _payCollect(rt);
  h = h.replace(
    /<div class="banner">[\s\S]*?<\/div>/,
    '<div class="banner">' +
      ic('wallet') +
      '<span>Record received counter payments or send an Easebuzz payment link. Verified online payments are recorded automatically with a receipt.' +
      (modeOf('easebuzz') === 'live' ? '' : ' Connect Easebuzz in Settings to create links.') +
      ' INR checkout is available. AED checkout requires Easebuzz multicurrency setup.</span></div>',
  );
  if (S.payPick) {
    h = h.replace(
      '<button class="btn primary" type="submit">Record payment (simulated)</button>',
      '<button class="btn primary" type="submit">Record payment</button>' +
        '<button class="btn" type="button" data-act="payLink" data-id="' +
        esc(S.payPick) +
        '"' +
        (creatingPaymentLink ? ' disabled aria-busy="true"' : '') +
        '>' +
        ic('link') +
        ' ' +
        (creatingPaymentLink ? 'Creating link…' : 'Send payment link') +
        '</button>',
    );
  }
  return h.replace('Recorded (simulated)', 'Recorded');
};
ACT.payLink = function (d) {
  if (creatingPaymentLink) return;
  var amt = document.querySelector('#payf [name=amt]');
  var button = document.querySelector('#payf [data-act=payLink]');
  if (!button) return;
  var user = S.user;
  var label = button.innerHTML;
  creatingPaymentLink = true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Creating link…';
  req('POST', '/payments/links', { enrollmentId: d.id, amount: amt ? +amt.value : undefined })
    .then(function (r) {
      if (S?.user !== user) return;
      openModal('plink', { link: r });
      tracePaymentLink(d.id, r);
    })
    .catch(function (e) {
      if (S?.user === user) toast(e.message, 'err');
    })
    .finally(function () {
      creatingPaymentLink = false;
      var displayed = document.querySelector('#payf [data-act=payLink]');
      if (!displayed) return;
      displayed.disabled = false;
      displayed.removeAttribute('aria-busy');
      displayed.innerHTML = label;
    });
};

const checkedPaymentLinks = new Set();
async function tracePaymentLink(orderReference, link) {
  if (!canLogEnrolment() || checkedPaymentLinks.has(link.id)) return;
  checkedPaymentLinks.add(link.id);
  const user = S.user;
  const targetOrder = link.enrollmentId || orderReference;
  const details = { orderReference: targetOrder, provider: link.provider, sandbox: link.sandbox };
  if (targetOrder !== orderReference) details.sourceOrder = orderReference;
  enrolmentConsoleLog('Payment link created', details);

  try {
    const result = await req('GET', '/payments/links/' + encodeURIComponent(link.id) + '/status');
    if (S?.user !== user) return;
    enrolmentConsoleLog('Payment link status', {
      ...details,
      status: result.status,
      paymentStatus: result.paymentStatus,
    });
  } catch (error) {
    if (S?.user === user)
      enrolmentConsoleLog('Payment link status unavailable', { ...details, httpStatus: error.status }, true);
  }
}

function paymentLinkProgress(link) {
  const receipt = paymentRecordsForView().find((payment) => payment.gateway?.link === link.id);
  if (!receipt) return 'Awaiting payment confirmation';
  return 'Payment confirmed · ' + money(receipt.amt, receipt.cur) + ' · Receipt ' + receipt.rc;
}

function refreshPaymentLinkProgress() {
  if (S.modal?.t !== 'plink') return;
  const status = document.querySelector('[data-payment-link-progress]');
  if (!status) return;
  const next = paymentLinkProgress(S.modal.link);
  if (status.textContent !== next) status.textContent = next;
}

MODALS.plink = function (m) {
  var l = m.link;
  return {
    title: 'Payment link',
    size: 'sm2',
    body:
      '<p class="sm">' +
      money(l.amount, l.currency) +
      ' via <b>' +
      esc(INTEG_LABEL[l.provider] || l.provider) +
      '</b>. ' +
      (l.opp
        ? 'The student is enrolled when the payment is confirmed.'
        : 'The payment is recorded automatically after confirmation.') +
      (l.expiresAt ? ' The link is valid for 24 hours.' : '') +
      '</p><p class="sm" role="status" data-payment-link-progress>' +
      esc(paymentLinkProgress(l)) +
      '</p><div class="f"><label for="plurl">Link</label><input id="plurl" readonly value="' +
      esc(l.url) +
      '"></div>',
    foot:
      '<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="copy" data-v="' +
      esc(l.url) +
      '">Copy link</button><a class="btn primary" href="' +
      esc(l.url) +
      '" target="_blank" rel="noopener noreferrer">Open checkout</a>' +
      (l.sandbox
        ? ''
        : '<button class="btn" data-act="plSend" data-id="' +
          esc(l.id) +
          '" data-ch="Email">Send by e-mail</button><button class="btn primary" data-act="plSend" data-id="' +
          esc(l.id) +
          '" data-ch="WhatsApp">Send on WhatsApp</button>'),
  };
};
ACT.plSend = function (d) {
  req('POST', '/payments/links/' + encodeURIComponent(d.id) + '/send', { channel: d.ch })
    .then(function () {
      closeModal();
      toast('Payment link sent by ' + d.ch, 'ok');
      if (S?.route?.page === 'payLinks') loadPL();
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
// Invoice / receipt PDF – the same files the parent receives with the receipt e-mail
ACT.payPdf = function (d) {
  fetch(API + '/payments/' + encodeURIComponent(d.id) + '/' + (d.kind === 'invoice' ? 'invoice' : 'receipt') + '.pdf', {
    credentials: 'same-origin',
  })
    .then(function (r) {
      if (!r.ok)
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (j) {
            throw new Error(j.error || 'Could not create the PDF');
          });
      var name = ((r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || d.kind + '.pdf';
      return r.blob().then(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 1000);
      });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
var _receipt = MODALS.receipt;
MODALS.receipt = function (m) {
  var x = _receipt(m);
  x.foot = x.foot.replace(
    '<button class="btn primary" data-act="genReceipt"',
    '<button class="btn" data-act="payPdf" data-kind="invoice" data-id="' +
      esc(m.id) +
      '">' +
      ic('download') +
      ' Invoice PDF</button>' +
      '<button class="btn" data-act="payPdf" data-kind="receipt" data-id="' +
      esc(m.id) +
      '">' +
      ic('download') +
      ' Receipt PDF</button>' +
      '<button class="btn primary" data-act="genReceipt"',
  );
  x.foot = x.foot.replace('Generate receipt (simulated)', 'Open printable receipt');
  var rp = paymentRecordsForView().find(function (y) {
    return y.id === m.id;
  });
  if (rp && rp.status === 'Cancelled')
    x.body =
      '<div class="banner" style="background:var(--crit-bg,#fdecec);color:var(--crit,#b42318);display:block;margin-bottom:10px"><b>Cancelled</b> on ' +
      esc(fDT(rp.cancel.at)) +
      ' by ' +
      esc(rp.cancel.by) +
      ' · with the parent’s knowledge: ' +
      esc(rp.cancel.parentAware) +
      '<br>Reason: ' +
      esc(rp.cancel.reason) +
      '</div>' +
      x.body;
  else if (rp && !rp.test && canCancelPay())
    x.foot =
      '<button class="btn danger" data-act="payCancel" data-id="' +
      esc(m.id) +
      '" style="margin-right:auto">Cancel transaction</button>' +
      x.foot;
  x.body = x.body
    .replace('<span class="sim">Simulated</span>', '')
    .replace(
      'Prototype receipt – not a valid tax document. Finance linkage to ERPNext Accounts is pending integration.',
      'Receipt numbers are issued by the server. Payments are posted to ERPNext Accounts as Payment Entries.',
    );
  return x;
};
