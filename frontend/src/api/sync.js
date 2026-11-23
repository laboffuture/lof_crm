/* Snapshot of local state and PUT /sync of changed records; merging the server reply. */
var snap = {},
  snapSet = {},
  busy = false,
  again = false,
  deferredRender = false;
function takeSnap() {
  snap = {};
  Object.keys(COLL).forEach(function (c) {
    var m = new Map();
    (S[c] || []).forEach(function (d) {
      m.set(d.id, JSON.stringify(d));
    });
    snap[c] = m;
  });
  snapSet = {};
  SETTINGS.forEach(function (k) {
    snapSet[k] = JSON.stringify(S[k]);
  });
}
/** Remove prototype "(simulated …)" wording from text the screens write; integrations are real now. */
var SIM_RE = /\s?\((?:simulated|Simulated)[^)"]*\)/g;
function clean(j) {
  return SIM_RE.test(j) ? ((SIM_RE.lastIndex = 0), j.replace(SIM_RE, '')) : j;
}
function diff(dry) {
  var changes = [],
    settings = [];
  Object.keys(COLL).forEach(function (c) {
    var seen = new Set();
    (S[c] || []).forEach(function (d) {
      if (!d || !d.id) return;
      seen.add(d.id);
      var j = JSON.stringify(d);
      var before = snap[c].get(d.id);
      if (before !== j) {
        j = clean(j);
        if (before === j) return;
        var ch = { coll: c, id: d.id, op: 'upsert', doc: JSON.parse(j) };
        if (before) ch.base = JSON.parse(clean(before)); // the version this user edited – the server applies only their changes
        changes.push(ch);
        if (!dry) snap[c].set(d.id, j);
      }
    });
    snap[c].forEach(function (_, id) {
      if (!seen.has(id)) {
        changes.push({ coll: c, id: id, op: 'delete' });
        if (!dry) snap[c].delete(id);
      }
    });
  });
  SETTINGS.forEach(function (k) {
    var j = JSON.stringify(S[k]);
    if (snapSet[k] !== j) {
      settings.push({ key: k, doc: JSON.parse(j) });
      if (!dry) snapSet[k] = j;
    }
  });
  return { changes: changes, settings: settings };
}
function mergeDocs(docs) {
  (docs || []).forEach(function (x) {
    var arr = S[x.coll];
    if (!arr) return;
    var i = arr.findIndex(function (d) {
      return d.id === x.doc.id;
    });
    if (i >= 0) arr[i] = x.doc;
    else arr.unshift(x.doc);
    snap[x.coll].set(x.doc.id, JSON.stringify(x.doc));
    if (x.coll === 'ms') watchLmsCall(x.doc);
  });
}
function userIsTyping() {
  var a = document.activeElement;
  return !!(
    a &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) &&
    a.id !== 'gs' &&
    a.id !== 'lq' &&
    a.id !== 'sq' &&
    a.id !== 'auq'
  );
}
function safeRender() {
  if (S.modal || userIsTyping() || S.route.page === 'wizard') {
    deferredRender = true;
    return;
  }
  deferredRender = false;
  render();
}
function flush() {
  if (!S || !snap.leads) return Promise.resolve();
  if (busy) {
    again = true;
    return Promise.resolve();
  }
  applyRemaps();
  var d = diff();
  if (!d.changes.length && !d.settings.length) return Promise.resolve();
  busy = true;
  setSaving(true);
  return req('PUT', '/sync', d)
    .then(function (r) {
      mergeDocs(r.docs);
      if (r.settings && r.settings.length)
        SETTINGS.forEach(function (k) {
          snapSet[k] = JSON.stringify(S[k]);
        });
      (r.notices || []).forEach(function (n) {
        toast(n, 'ok');
      });
      safeRender();
    })
    .catch(function (e) {
      if (e.message === 'Signed out') return;
      toast('Not saved: ' + e.message, 'err');
      return reload(true);
    })
    .then(function () {
      busy = false;
      setSaving(false);
      if (again) {
        again = false;
        return flush();
      }
    });
}
var flushTimer = null;
function scheduleFlush(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms || 0);
}
['click', 'submit', 'change', 'drop'].forEach(function (ev) {
  document.addEventListener(ev, function () {
    scheduleFlush(30);
  });
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === 'Escape') scheduleFlush(30);
});
window.addEventListener('beforeunload', function (e) {
  if (S && snap.leads && (diff(true).changes.length || busy)) {
    flush();
    e.preventDefault();
  }
});

function setSaving(on) {
  var el = document.getElementById('lofSaving');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lofSaving';
    el.style.cssText =
      'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:300;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:2px 10px;font-size:11.5px;color:var(--muted);box-shadow:var(--shadow);display:none';
    el.textContent = 'Saving…';
    document.body.appendChild(el);
  }
  el.style.display = on ? 'block' : 'none';
}
