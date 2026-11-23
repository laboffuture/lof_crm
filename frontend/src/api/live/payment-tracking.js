// ---------------- Payments → Payment links / Cancelled
// Every payment link: who it went to, who created and sent it (how, when) and whether the parent paid.
// Counsellors see only the links they shared (the server filters). Cancelled transactions have their own section.
function canSeeLinks() {
  return can('payments', 'V') || can('payments', 'C') || can('enrollments', 'C') || can('opportunities', 'E');
}
window.canSeeLinks = canSeeLinks;
(function () {
  var g = GROUPS.find(function (x) {
    return x.id === 'pay';
  });
  if (!g) return;
  var at =
    g.tabs.findIndex(function (t) {
      return t[0] === 'payRecords';
    }) + 1;
  g.tabs.splice(
    at,
    0,
    ['payCancelled', 'Cancelled', 'x', 'payments'],
    ['payLinks', 'Payment links', 'link', '*plinks'],
  );
})();
function loadPL() {
  const owner = S;
  if (!owner) return;
  const cache = (owner.paymentLinkList ||= { items: null, own: false, loading: false, at: 0, error: '' });
  if (cache.loading) return;
  cache.loading = true;
  cache.error = '';
  req('GET', '/payments/link-list')
    .then((r) => {
      cache.items = r.items || [];
      cache.own = !!r.own;
    })
    .catch((e) => {
      if (e.message !== 'Signed out') cache.error = e.message;
    })
    .finally(() => {
      cache.at = Date.now();
      cache.loading = false;
      if (S === owner) safeRender();
    });
}
var PL_KIND = {
  opp: 'Opportunity – enrols on payment',
  collect: 'Payment collection',
  reminder: 'Instalment reminder',
};
function plStatus(x) {
  if (x.status === 'paid')
    return x.applyError
      ? ['Paid – enrol by hand', 'crit']
      : x.paymentStatus === 'Cancelled'
        ? ['Paid – payment cancelled later', 'warn']
        : ['Paid', 'ok'];
  return (
    {
      created: ['Awaiting payment', 'warn'],
      expired: ['Not paid – expired', 'crit'],
      replaced: ['Not paid – replaced', ''],
      cancelled: ['Not paid – cancelled', ''],
      failed: ['Payment failed', 'crit'],
    }[x.status] || [x.status, '']
  );
}
CHG.plF = function (el) {
  S.plF = el.value;
  render();
};
INP.plQ = function (el) {
  S.plQ = el.value;
  render();
};
ACT.plRefresh = function () {
  loadPL();
};

PAGES.payLinks = function () {
  if (!canSeeLinks()) return ph('Payment links', '') + emptyBox('No access', 'Your role cannot see payment links.');
  const PL = (S.paymentLinkList ||= { items: null, own: false, loading: false, at: 0, error: '' });
  if (!PL.loading && (!PL.at || Date.now() - PL.at > 60_000)) loadPL();
  var all = PL.items || [],
    f = S.plF || '',
    q = String(S.plQ || '')
      .toLowerCase()
      .trim();
  var group = function (x) {
    return x.status === 'paid' ? 'paid' : x.status === 'created' ? 'open' : 'unpaid';
  };
  var rows = all.filter(function (x) {
    if (f && group(x) !== f) return false;
    if (!q) return true;
    return [x.id, x.student, x.parent, x.phone, x.email, x.createdBy, x.sentBy, x.opp, x.enrollment, x.receipt].some(
      function (v) {
        return (
          String(v || '')
            .toLowerCase()
            .indexOf(q) >= 0
        );
      },
    );
  });
  // collected = paid through a link and not cancelled afterwards
  var paid = all.filter(function (x) {
    return x.status === 'paid' && x.paymentStatus !== 'Cancelled';
  });
  var sum = paid.reduce(function (a, x) {
    return a + toAED(x.amount, x.currency);
  }, 0);
  var cols = [
    {
      h: 'Shared',
      s: function (x) {
        return x.createdAt;
      },
      f: function (x) {
        return fDT(x.createdAt) + '<div class="muted xs">by ' + esc(x.createdBy || '—') + '</div>';
      },
    },
    {
      h: 'To (parent)',
      f: function (x) {
        return (
          '<b>' +
          esc(x.parent || '—') +
          '</b><div class="muted xs">' +
          esc([x.phone, x.email].filter(Boolean).join(' · ')) +
          '</div>'
        );
      },
    },
    {
      h: 'Student / for',
      f: function (x) {
        return (
          (x.studentId ? '<a ' + sgo(x.studentId) + '>' + esc(x.student) + '</a>' : esc(x.student || '—')) +
          '<div class="muted xs">' +
          esc(x.prog) +
          ' · ' +
          esc(branchName(x.branch)) +
          '</div><div class="muted xs">' +
          esc(PL_KIND[x.kind] || x.kind) +
          ' · <span class="mono">' +
          esc(x.kind === 'opp' ? x.opp || '' : x.enrollment || x.opp || '') +
          '</span></div>'
        );
      },
    },
    {
      h: 'Amount',
      r: 1,
      s: function (x) {
        return toAED(x.amount, x.currency);
      },
      f: function (x) {
        return money(x.amount, x.currency);
      },
    },
    {
      h: 'Sent',
      f: function (x) {
        return x.sentAt
          ? esc(x.sentVia || '') +
              ' · ' +
              fDT(x.sentAt) +
              '<div class="muted xs">by ' +
              esc(x.sentBy || '—') +
              (x.sentTo ? ' to ' + esc(x.sentTo) : '') +
              (x.sends > 1 ? ' · sent ' + x.sends + ' times' : '') +
              '</div>'
          : '<span class="muted xs">Not sent from the CRM (link copied, or not sent yet)</span>';
      },
    },
    {
      h: 'Paid?',
      f: function (x) {
        var st = plStatus(x);
        var more =
          x.status === 'paid'
            ? (x.paidAt ? fDT(x.paidAt) : '') + (x.receipt ? ' · <span class="mono">' + esc(x.receipt) + '</span>' : '')
            : x.status === 'created'
              ? x.expiresAt
                ? 'Valid until ' + fDT(x.expiresAt)
                : 'Open until the next reminder'
              : '';
        return (
          bdg(st[0], st[1]) +
          (more ? '<div class="muted xs">' + more + '</div>' : '') +
          (x.applyError ? '<div class="muted xs">' + esc(x.applyError) + '</div>' : '')
        );
      },
    },
    {
      h: '',
      f: function (x) {
        return x.status === 'created'
          ? '<button class="btn sm" data-act="copy" data-v="' +
              esc(x.url) +
              '">Copy</button> <button class="btn sm" data-act="plSend" data-id="' +
              esc(x.id) +
              '" data-ch="WhatsApp">WhatsApp</button> <button class="btn sm" data-act="plSend" data-id="' +
              esc(x.id) +
              '" data-ch="Email">E-mail</button>'
          : '';
      },
    },
  ];
  var tools =
    '<input id="plQ" data-input="plQ" value="' +
    esc(S.plQ || '') +
    '" placeholder="Search parent, student, mobile, link…" aria-label="Search payment links" style="min-width:240px">' +
    '<select data-change="plF" aria-label="Status"><option value="">All links</option><option value="open"' +
    (f === 'open' ? ' selected' : '') +
    '>Awaiting payment</option><option value="paid"' +
    (f === 'paid' ? ' selected' : '') +
    '>Paid</option><option value="unpaid"' +
    (f === 'unpaid' ? ' selected' : '') +
    '>Not paid (expired / replaced)</option></select>' +
    '<button class="btn" data-act="plRefresh">' +
    ic('refresh') +
    ' Refresh</button>';
  return (
    ph(
      'Payment links',
      PL.own
        ? 'The payment links you shared – whether each parent paid'
        : 'Every payment link shared with parents – who sent it and whether it was paid',
      tools,
    ) +
    '<div class="sum"><div class="it"><small>Links</small><b>' +
    all.length +
    '</b></div><div class="it"><small>Paid</small><b>' +
    paid.length +
    '</b></div><div class="it"><small>Collected through links (AED equivalent)</small><b>' +
    Math.round(sum).toLocaleString('en-US') +
    '</b></div><div class="it"><small>Awaiting payment</small><b>' +
    all.filter(function (x) {
      return x.status === 'created';
    }).length +
    '</b></div><div class="it"><small>Not paid</small><b>' +
    all.filter(function (x) {
      return group(x) === 'unpaid';
    }).length +
    '</b></div></div>' +
    (PL.own
      ? '<div class="banner" style="margin-bottom:12px">' +
        ic('link') +
        '<span>You see the payment links you created or sent. Centre Administrators, Reception and Management see all links of their branches.</span></div>'
      : '') +
    card(
      '',
      PL.items
        ? table('plinks', cols, rows, {
            ps: 15,
            et: all.length ? 'No links match' : 'No payment links yet',
            ed: all.length
              ? 'Change the search or the status filter.'
              : 'Links shared from an opportunity, from Payments → Collect or with instalment reminders appear here.',
          })
        : '<p class="muted" style="padding:16px">Loading payment links…</p>',
      { np: 1 },
    )
  );
};

// Cancelled transactions: their own section; Payment Records lists only active payments
ACT.payCancelCsv = function () {
  var ps = S.pay.filter(function (p) {
    return p.status === 'Cancelled' && inScope(p.branch);
  });
  openModal('csv', {
    name: 'cancelled-transactions',
    head: [
      'Payment',
      'Receipt',
      'Paid on',
      'Student',
      'Branch',
      'Enrolment',
      'Amount',
      'Currency',
      'Method',
      'Reference',
      'Cancelled on',
      'Cancelled by',
      "Parent's knowledge",
      'Reason',
    ],
    rows: ps.map(function (p) {
      var s = stuById(p.stu),
        c = p.cancel || {};
      return [
        p.id,
        p.rc,
        fDT(p.at),
        s ? s.first + ' ' + s.last : p.stu,
        branchName(p.branch),
        p.enr,
        p.amt,
        p.cur,
        p.method,
        p.ref,
        c.at ? fDT(c.at) : '',
        c.by || '',
        c.parentAware || '',
        c.reason || '',
      ];
    }),
  });
};
PAGES.payCancelled = function () {
  if (!can('payments', 'V'))
    return ph('Cancelled transactions', '') + emptyBox('No access', 'Your role cannot see payments.');
  var when = function (p) {
    return (p.cancel && p.cancel.at) || p.at;
  };
  var ps = S.pay
    .filter(function (p) {
      return p.status === 'Cancelled' && inScope(p.branch);
    })
    .sort(function (a, b) {
      return new Date(when(b)) - new Date(when(a));
    });
  var tot = ps.reduce(function (a, p) {
    return a + toAED(p.amt, p.cur);
  }, 0);
  var cols = [
    {
      h: 'Cancelled',
      s: when,
      f: function (p) {
        return fDT(when(p)) + '<div class="muted xs">by ' + esc((p.cancel || {}).by || '—') + '</div>';
      },
    },
    {
      h: 'Receipt',
      f: function (p) {
        return (
          '<a data-act="receipt" data-id="' +
          esc(p.id) +
          '" class="mono">' +
          esc(p.rc) +
          '</a><div class="mono muted xs">' +
          esc(p.id) +
          '</div>'
        );
      },
    },
    {
      h: 'Student',
      f: function (p) {
        var s = stuById(p.stu);
        return s ? '<a ' + sgo(s.id) + '>' + esc(s.first + ' ' + s.last) + '</a>' : esc(p.stu);
      },
    },
    {
      h: 'Branch / enrolment',
      f: function (p) {
        return esc(branchName(p.branch)) + '<div class="mono muted xs">' + esc(p.enr) + '</div>';
      },
    },
    {
      h: 'Amount',
      r: 1,
      s: function (p) {
        return toAED(p.amt, p.cur);
      },
      f: function (p) {
        return money(p.amt, p.cur);
      },
    },
    {
      h: 'Originally paid',
      f: function (p) {
        return (
          fDT(p.at) +
          '<div class="muted xs">' +
          esc(p.method) +
          (p.ref && p.ref !== '—' ? ' · ' + esc(p.ref) : '') +
          '</div>'
        );
      },
    },
    {
      h: "Parent's knowledge",
      f: function (p) {
        var a = (p.cancel || {}).parentAware;
        return a ? bdg(a, a === 'Yes' ? 'ok' : 'warn') : '—';
      },
    },
    {
      h: 'Reason',
      f: function (p) {
        return '<div style="min-width:200px">' + esc((p.cancel || {}).reason || '') + '</div>';
      },
    },
  ];
  return (
    ph(
      'Cancelled transactions',
      'Payments cancelled instead of deleted – receipt numbers are kept, the amounts are left out of every total',
      '<button class="btn" data-act="payCancelCsv">' + ic('download') + ' Export CSV</button>',
    ) +
    '<div class="sum"><div class="it"><small>Cancelled transactions</small><b>' +
    ps.length +
    '</b></div><div class="it"><small>Amount cancelled (AED equivalent)</small><b>' +
    Math.round(tot).toLocaleString('en-US') +
    '</b></div><div class="it muted xs">Not counted in Total collected, reports, dashboards or the enrolment balance</div></div>' +
    card(
      '',
      table('pcan', cols, ps, {
        ps: 15,
        et: 'No cancelled transactions',
        ed: 'Use Cancel payment on Payments → Records when a payment was taken by mistake.',
      }),
      { np: 1 },
    )
  );
};
var _payRecCan = PAGES.payRecords;
PAGES.payRecords = function (rt) {
  var h = _payRecCan(rt);
  var n = S.pay.filter(function (p) {
    return p.status === 'Cancelled' && inScope(p.branch);
  }).length;
  return n
    ? h.replace(
        '<div class="it muted xs">INR converted at',
        '<div class="it"><small>Cancelled</small><b><a data-act="go" data-page="payCancelled" tabindex="0">' +
          n +
          '</a></b></div><div class="it muted xs">INR converted at',
      )
    : h;
};
