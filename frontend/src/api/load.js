/* GET /bootstrap: branch-scoped data and settings into the screens. */
function applyBootstrap(b, keepUi) {
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
  SETTINGS.forEach(function (k) {
    S[k] = b.data[k] || {};
  });
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
  S.ms.forEach(watchLmsCall);
}
function reload(force) {
  if (!force && (busy || S.modal || userIsTyping())) return Promise.resolve();
  return req('GET', '/bootstrap').then(function (b) {
    NOW = new Date();
    applyBootstrap(b, true);
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
      render();
      startTimers();
    })
    .catch(function (e) {
      if (e.message !== 'Signed out')
        app.innerHTML = '<div class="empty"><b>Could not load the CRM</b>' + esc(e.message) + '</div>';
    });
}
var timers = [];
function startTimers() {
  timers.forEach(clearInterval);
  timers = [
    setInterval(function () {
      NOW = new Date();
      TODAY = dayKey(NOW.toISOString());
      BASE = Date.parse(TODAY + 'T00:00:00+04:00');
    }, 30000),
    setInterval(function () {
      if (document.visibilityState === 'visible')
        flush().then(function () {
          return reload(false);
        });
    }, 45000),
    setInterval(pollIncoming, 8000),
  ];
}
var callSince = new Date().toISOString();
function pollIncoming() {
  if (!S || document.visibilityState !== 'visible' || S.callPop) return;
  req('GET', '/calls/incoming?since=' + encodeURIComponent(callSince))
    .then(function (r) {
      callSince = r.now;
      var ev = (r.events || []).find(function (e) {
        return e.lead_id && leadById(e.lead_id);
      });
      if (ev) {
        S.callPop = ev.lead_id;
        S.callPopReal = true;
        render();
      }
    })
    .catch(function () {});
}
