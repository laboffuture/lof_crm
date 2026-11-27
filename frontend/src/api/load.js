/* GET /bootstrap: branch-scoped data and settings into the screens. */
function applyBootstrap(b, keepUi) {
  const previousCalls = keepUi ? snap.ms : null;
  SERVER = b.server;
  if (!keepUi) {
    stopLmsPolling();
    S = seed(); // UI state shape from the prototype; data is replaced below
    S.saved = JSON.parse(LS.get('lof_saved_filters') || 'null') || S.saved;
    S.theme = LS.get('lof_theme') || null;
  }
  Object.keys(COLL).forEach(function (c) {
    S[c] = b.data[c] || [];
  });
  S.paymentSandbox = b.server.payments?.easebuzzSandbox ?? true;
  S.branchIdEdit = !!b.server.branchIdEdit; // System Administrator may change a branch Short ID (not on the live site)
  S.checkoutPayments = b.data.checkoutPayments || [];
  S.checkoutLms = b.data.checkoutLms || [];
  S.checkoutOrderIds = new Set(S.enr.filter((enrollment) => enrollment.sandboxSource).map((enrollment) => enrollment.id));
  S.checkoutPaid = new Map();
  for (const payment of S.checkoutPayments) {
    S.checkoutPaid.set(payment.enr, (S.checkoutPaid.get(payment.enr) || 0) + payment.amt);
  }
  SETTINGS.forEach(function (k) {
    S[k] = b.data[k] || {};
  });
  S.uatCheckoutBranches = b.server.payments?.uatCheckoutBranches || [];
  if (S.wiz) wizReconcileStudent();
  S.user = b.me.id;
  if (b.me && b.me.role === 'Reception' && S.perms && S.perms.reports) {
    S.perms.reports.Reception = 'V';
  }
  if (b.me && !['Management', 'System Administrator'].includes(b.me.role)) {
    var assigned = b.me.branch;
    if (assigned) {
      S.dashF = S.dashF || {};
      S.dashF.branch = assigned;
      S.lf = S.lf || {};
      S.lf.branch = assigned;
      S.rep = S.rep || { id: 'r1', f: {} };
      S.rep.f = S.rep.f || {};
      S.rep.f.branch = assigned;
      S.apF = S.apF || {};
      S.apF.branch = assigned;
    }
  }
  S.lmsServerReady = !!b.server.lmsSecrets;
  S.seq = makeSeq(b.seq);
  if (!keepUi) {
    S.calSel = TODAY;
    S.calMonth = TODAY.slice(0, 7);
  }
  takeSnap();
  S.ms.forEach(function (call) {
    const previous = previousCalls?.get(call.id);
    if (previous) logLmsCallChange(call, previous);
    watchLmsCall(call);
  });
}
function reload(force) {
  if (!force && (busy || (S.modal?.t !== 'plink' && (S.modal || userIsTyping())))) return Promise.resolve();
  return req('GET', '/bootstrap').then(function (b) {
    NOW = new Date();
    applyBootstrap(b, true);
    refreshPaymentLinkProgress();
    safeRender();
  });
}
function start() {
  var app = document.getElementById('app');
  app.innerHTML =
    '<div style="display:grid;place-items:center;height:100%;color:var(--muted)">Loading Lab of Future CRM…</div>';
  return req('GET', '/bootstrap')
    .then(function (b) {
      applyBootstrap(b, false);
      const restored = routeFromUrl();
      lastRouteHash = window.location.hash;
      if (restored) setRoute(restored.page, restored.p);
      render();
      startTimers();
    })
    .catch(function (e) {
      if (e.message !== 'Signed out')
        app.innerHTML = '<div class="empty"><b>Could not load the CRM</b>' + esc(e.message) + '</div>';
    });
}
var timers = [];
const backgroundRefreshMs = 20_000;
function startTimers() {
  timers.forEach(clearInterval);
  let refreshing = false;
  timers = [
    setInterval(function () {
      NOW = new Date();
      TODAY = dayKey(NOW.toISOString());
      BASE = Date.parse(TODAY + 'T00:00:00+04:00');
    }, 30000),
    setInterval(async function () {
      if (!S || refreshing || document.visibilityState !== 'visible') return;
      const session = S;
      refreshing = true;
      try {
        await flush();
        if (S === session && document.visibilityState === 'visible') await reload(false);
      } catch {
        // A later refresh can recover a temporary connection failure.
      } finally {
        refreshing = false;
      }
    }, backgroundRefreshMs),
    setInterval(pollIncoming, backgroundRefreshMs),
  ];
}
var callSince = new Date().toISOString();
let checkingIncoming = false;
async function pollIncoming() {
  if (!S || document.visibilityState !== 'visible' || S.callPop || checkingIncoming) return;
  const session = S;
  checkingIncoming = true;
  try {
    const r = await req('GET', '/calls/incoming?since=' + encodeURIComponent(callSince));
    if (S !== session) return;
    callSince = r.now;
    const ev = (r.events || []).find((e) => e.lead_id && leadById(e.lead_id));
    if (ev) {
      S.callPop = ev.lead_id;
      S.callPopReal = true;
      render();
    }
  } catch {
    // Keep the last cursor so the next check can recover any missed calls.
  } finally {
    checkingIncoming = false;
  }
}
