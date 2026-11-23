// ---------------- Payment link from an opportunity (Opportunity 30% / Admission Decision 70%)
// The counsellor fills in the enrolment form (student, programme, fee, payment term) and, instead of enrolling,
// creates a payment link. The server checks the form now and enrols the student automatically when the parent pays.
function canShareLink() {
  return can('enrollments', 'C') || can('opportunities', 'E') || can('payments', 'C');
}
var LINK_ST = {
  created: ['Awaiting payment', 'warn'],
  paid: ['Paid – enrolled', 'ok'],
  replaced: ['Replaced by a newer link', ''],
  expired: ['Expired', ''],
  cancelled: ['Cancelled', ''],
  failed: ['Failed', 'crit'],
};
function linkWhen(t) {
  return String(t || '')
    .replace('T', ' ')
    .slice(0, 16);
}
function oppLinksCard(o) {
  S.oppLinks = S.oppLinks || {};
  var L = S.oppLinks[o.id];
  if (L === undefined) {
    const owner = S;
    owner.oppLinks[o.id] = null;
    req('GET', '/opps/' + encodeURIComponent(o.id) + '/payment-links')
      .then((r) => {
        owner.oppLinks[o.id] = r.items || [];
      })
      .catch(() => {
        owner.oppLinks[o.id] = [];
      })
      .finally(() => {
        if (S === owner) safeRender();
      });
    return '';
  }
  if (!L || !L.length) return '';
  var rows = L.map(function (l) {
    var st =
      l.status === 'paid' && l.apply_error ? ['Paid – enrol by hand', 'crit'] : LINK_ST[l.status] || [l.status, ''];
    var act =
      l.status === 'created' && canShareLink()
        ? '<button class="btn sm" data-act="copy" data-v="' +
          esc(l.url) +
          '">Copy</button> <button class="btn sm" data-act="plSend" data-id="' +
          esc(l.id) +
          '" data-ch="WhatsApp">WhatsApp</button> <button class="btn sm" data-act="plSend" data-id="' +
          esc(l.id) +
          '" data-ch="Email">E-mail</button>'
        : l.status === 'paid' && !l.apply_error
          ? '<span class="mono xs">' + esc(l.enrollment_id) + '</span>'
          : '';
    if (l.status === 'created' && l.expires_at)
      st = [
        st[0] +
          ' · until ' +
          new Date(l.expires_at).toLocaleString([], {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
        st[1],
      ];
    return { l: l, st: st, act: act };
  });
  var cols = [
    {
      h: 'Link',
      f: function (r) {
        return '<span class="mono">' + esc(r.l.id) + '</span>';
      },
    },
    {
      h: 'Amount',
      r: 1,
      f: function (r) {
        return money(r.l.amount, r.l.currency);
      },
    },
    {
      h: 'Status',
      f: function (r) {
        return (
          bdg(r.st[0], r.st[1]) + (r.l.apply_error ? '<div class="muted xs">' + esc(r.l.apply_error) + '</div>' : '')
        );
      },
    },
    {
      h: 'Shared',
      f: function (r) {
        return esc(r.l.created_by || '') + '<div class="muted xs">' + esc(linkWhen(r.l.created_at)) + '</div>';
      },
    },
    {
      h: '',
      f: function (r) {
        return r.act;
      },
    },
  ];
  return (
    '<div style="height:14px"></div>' +
    card(
      'Payment links',
      table('oppLinks', cols, rows, { all: 1 }) +
        '<p class="muted xs" style="padding:0 14px 12px">When the parent pays, the student is enrolled with the details filled in when the link was shared, and the receipt follows automatically.</p>',
      { np: 1 },
    )
  );
}
var _oppPage = PAGES.opp;
PAGES.opp = function (rt) {
  var h = _oppPage(rt);
  var o = typeof oppById === 'function' ? oppById(rt.id) : null;
  if (!o || !inScope(o.branch)) return h;
  if (!S.paymentSandbox && !['Enrolled', 'Lost'].includes(o.stage) && canShareLink()) {
    var btn =
      '<button class="btn primary" data-act="oppPayLink" data-id="' +
      esc(o.id) +
      '">' +
      ic('link') +
      ' Share payment link</button>';
    h = h.replace('<div class="row" style="margin-bottom:14px">', '<div class="row" style="margin-bottom:14px">' + btn);
    h = h.replace('<button class="btn primary" data-act="enrollOpp"', '<button class="btn" data-act="enrollOpp"');
  }
  return h + oppLinksCard(o);
};
ACT.oppPayLink = function (d) {
  if (S.paymentSandbox) return;
  ACT.enrollOpp({ ...d, viaLink: true });
};
var _wizMode = ACT.wizMode;
ACT.wizMode = function (d) {
  var via = S.wiz && S.wiz.viaLink;
  _wizMode(d);
  if (via && S.wiz) {
    S.wiz.viaLink = true;
    render();
  }
};
var _wizCancel = ACT.wizCancel;
ACT.wizCancel = function () {
  var w = S.wiz;
  if (w && w.viaLink && w.opp) {
    S.wiz = null;
    S.wizQ = '';
    go('opp', { id: w.opp });
    return;
  }
  _wizCancel();
};
var _wizPage = PAGES.wizard;
PAGES.wizard = function (rt) {
  var h = _wizPage(rt),
    w = S.wiz;
  if (!w || !w.viaLink) return h;
  h = h.replace('3. Payment &amp; confirm', '3. Payment link').replace('3. Payment & confirm', '3. Payment link');
  var o = w.opp && oppById(w.opp);
  h = h.replace(
    '<div class="step">',
    '<div class="banner" style="margin-bottom:12px">' +
      ic('link') +
      '<span>Payment link for <b>' +
      esc(o ? o.student : '') +
      '</b>: fill in the enrolment details the parent would give at the counter. Nothing is enrolled yet – the student is enrolled automatically as soon as the parent pays through the link.</span></div><div class="step">',
  );
  if (w.step === 3 && w.fee) {
    var c = calcFee(w.fee, w.disc, w.mode === 'new'),
      sch = buildSched(termById(w.term), c.total, TODAY),
      cur = w.fee.cur;
    var plan = w.linkPlan || (sch.length > 1 ? 'first' : 'full');
    var opt = function (v, label, sub) {
      return (
        '<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;margin-bottom:8px"><input type="radio" name="plan" value="' +
        v +
        '" data-change="wizPlan"' +
        (plan === v ? ' checked' : '') +
        ' style="margin-top:3px"><span><b>' +
        label +
        '</b><br><span class="muted xs">' +
        sub +
        '</span></span></label>'
      );
    };
    var form =
      '<form id="wf3" data-submit="wizLink"><div class="sec" style="margin-top:0">What the parent pays through the link</div>' +
      (sch.length > 1
        ? opt(
            'first',
            'First instalment – ' + money(sch[0].amt, cur),
            esc(termName(w.term)) +
              ': the remaining ' +
              (sch.length - 1) +
              ' instalment' +
              (sch.length > 2 ? 's follow' : ' follows') +
              ' the payment schedule below',
          )
        : '') +
      opt('full', 'Full fee – ' + money(c.total, cur), 'Everything in one payment') +
      '<p class="muted xs">To switch between full payment and instalments, go Back and pick the payment term.</p></form>';
    h = h.replace(
      /<form id="wf3" data-submit="wizFinish">[\s\S]*?<\/form>(<div class="banner" style="margin-top:12px">[\s\S]*?<\/div>)?/,
      function () {
        return (
          form +
          '<div class="banner" style="margin-top:12px">' +
          ic('check') +
          '<span>Send the link to the parent by WhatsApp or e-mail. When they pay, the student is enrolled, the receipt is issued. LMS delivery starts once the fee is fully paid – no one needs to finish the enrolment by hand.</span></div>'
        );
      },
    );
    h = h.replace('>Complete enrolment</button>', '>' + ic('link') + ' Create payment link</button>');
  }
  return h;
};
CHG.wizPlan = function (el) {
  if (S.wiz) S.wiz.linkPlan = el.value;
};
var _wizFinish = SUB.wizFinish;
SUB.wizLink = function (d, f) {
  var w = S.wiz;
  if (!w || !w.viaLink || !w.fee || w.linkSaving) return;
  var oppId = w.opp;
  var c = calcFee(w.fee, w.disc, w.mode === 'new'),
    sch = buildSched(termById(w.term), c.total, TODAY);
  var plan = d.plan || w.linkPlan || (sch.length > 1 ? 'first' : 'full');
  var amount = plan === 'full' ? c.total : sch[0].amt;
  var btn = document.querySelector('[data-act="wizNext"]');
  if (btn) btn.disabled = true;
  const state = S;
  const saved = new Map();
  w.linkSaving = true;
  flush()
    .then(function () {
      if (S !== state || S.wiz !== w) return;
      for (const key of Object.keys(COLL)) saved.set(key, JSON.stringify(S[key] || []));
      let changes;
      try {
        _wizFinish({ amt: '0', method: 'Cash', ref: '' }, f, { draft: true });
        applyRemaps();
        const draftTypes = ['students', 'enr', 'opps', 'leads', 'ms', 'notifs', 'audit'];
        changes = diff(true).changes.filter((change) => draftTypes.includes(change.coll) && change.op === 'upsert');
      } finally {
        for (const [key, snapshot] of saved) S[key] = JSON.parse(snapshot);
      }
      if (!changes.some((change) => change.coll === 'enr'))
        throw new Error('Check the enrolment details – the form is not complete');
      return req('POST', '/opps/' + encodeURIComponent(oppId) + '/payment-link', {
        changes: changes,
        amount: amount,
      }).then(function (r) {
        if (S !== state || S.wiz !== w) return;
        if (r.oppDoc) mergeDocs([{ coll: 'opps', doc: r.oppDoc }]);
        S.wiz = null;
        S.wizQ = '';
        if (S.oppLinks) delete S.oppLinks[oppId];
        go('opp', { id: oppId });
        openModal('plink', { link: r });
      });
    })
    .catch(function (e) {
      if (S === state) toast(e.message, 'err');
    })
    .finally(function () {
      w.linkSaving = false;
      if (btn) btn.disabled = false;
    });
};
