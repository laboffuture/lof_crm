/* Replaces prototype simulators with live status banners; removes demo-only controls. */
var modeOf = function (k) {
  return (SERVER.integrations || {})[k] || 'mock';
};

window.simBanner = function () {
  var mock = Object.keys(INTEG_LABEL).filter(function (k) {
    return modeOf(k) !== 'live';
  });
  if (!mock.length) return '';
  return (
    '<div class="banner">' +
    ic('alert') +
    '<span>Connected to the LOF server' +
    (SERVER.env && SERVER.env !== 'production' ? ' (' + esc(SERVER.env) + ')' : '') +
    '. Running in <b>mock mode</b>: ' +
    mock
      .map(function (k) {
        return INTEG_LABEL[k];
      })
      .join(', ') +
    '. Live status: Settings → Testing console.</span></div>'
  );
};

window.addPay = function (st, e, amt, method, ref, date, by) {
  var k = e.branch;
  st.seq.rc[k] = (st.seq.rc[k] || 0) + 1;
  var n = st.seq.pay;
  st.seq.pay = n + 1;
  var p = {
    id: FMT.pay(n),
    enr: e.id,
    stu: e.stu,
    amt: amt,
    cur: e.cur,
    method: method,
    ref: ref,
    at: date.length <= 10 ? date + 'T11:00:00+04:00' : date,
    rc: 'RC-' + k + '-26-' + p2(st.seq.rc[k], 4),
    status: 'Recorded',
    by: by,
    branch: e.branch,
  };
  st.pay.push(p);
  e.paid = r2(e.paid + amt);
  e.payStatus = e.paid >= e.total - 0.005 ? 'Paid' : e.paid > 0 ? 'Partially paid' : 'Unpaid';
  return p;
};

window.runSync = function (id) {
  var m = S.ms.find(function (x) {
    return x.id === id;
  });
  if (!m) return;
  if (snap.ms && snap.ms.has(id) && ['Failed', 'Retry Required', 'Awaiting Setup'].includes(m.status)) {
    req('POST', '/lms/calls/' + encodeURIComponent(id) + '/retry')
      .then(function (result) {
        mergeDocs([{ coll: 'ms', doc: result }]);
        safeRender();
        if (result.status !== 'Pending' && result.status !== 'Processing') showLmsResult(result);
      })
      .catch(function (error) {
        toast(error.message, 'err');
      });
    return;
  }
  scheduleFlush(0);
  // Newly saved/paid calls are watched when their server records are merged.
  if (snap.ms && snap.ms.has(id)) watchLmsCall(m);
};

// One read-only watcher per queued call, shared by registration, payments and retries.
var lmsPolls = new Map();
function showLmsResult(m) {
  var op = m.op === 'cancel' ? 'cancel' : 'enrol';
  toast(
    m.status === 'Success'
      ? 'LMS ' + op + ' received for ' + m.enr + (m.deliveryMode === 'mock' ? ' (mock)' : '')
      : 'LMS ' + op + ' call ' + m.status.toLowerCase() + ': ' + m.err,
    m.status === 'Success'
      ? 'ok'
      : ['Awaiting Payment', 'Awaiting Setup', 'Warnings'].includes(m.status)
        ? 'warn'
        : 'err',
  );
}
function stopLmsPolling(id) {
  if (id === undefined) {
    lmsPolls.forEach(function (poll) {
      clearTimeout(poll.timer);
    });
    lmsPolls.clear();
    return;
  }
  var poll = lmsPolls.get(id);
  if (poll) clearTimeout(poll.timer);
  lmsPolls.delete(id);
}
function watchLmsCall(m) {
  var id = m.id;
  if (m.status !== 'Pending' && m.status !== 'Processing') {
    stopLmsPolling(id);
    return;
  }
  if (!S || lmsPolls.has(id)) return;
  var poll = { user: S.user, attempts: 0, timer: null };
  lmsPolls.set(id, poll);
  function current() {
    return S && S.user === poll.user && lmsPolls.get(id) === poll;
  }
  function schedule() {
    if (!current()) return;
    // The normal background refresh can resume watching jobs that take longer.
    if (poll.attempts >= 16) {
      stopLmsPolling(id);
      return;
    }
    poll.timer = setTimeout(
      function () {
        if (!current()) return;
        poll.attempts++;
        req('GET', '/lms/calls/' + encodeURIComponent(id))
          .then(function (result) {
            if (!current()) return;
            var previous = S.ms.find(function (call) {
              return call.id === id;
            });
            if (!previous) {
              stopLmsPolling(id);
              return;
            }
            var changed = JSON.stringify(previous) !== JSON.stringify(result);
            mergeDocs([{ coll: 'ms', doc: result }]);
            // Update status even if a secondary refresh fails; keep open forms intact.
            if (changed) safeRender();
            if (result.status === 'Pending' || result.status === 'Processing') {
              schedule();
              return;
            }
            showLmsResult(result);
          })
          .catch(function (error) {
            if (!current()) return;
            if ([401, 403, 404].includes(error.status) || error.message === 'Signed out') stopLmsPolling(id);
            else schedule();
          });
      },
      poll.attempts === 0 ? 1500 : 2000,
    );
  }
  schedule();
}

ACT.setUser = function (d) {
  if (!SERVER.impersonation) {
    toast('Role preview is disabled on this server', 'warn');
    return;
  }
  S.menu = null;
  req('POST', '/auth/impersonate', { staffId: d.u })
    .then(function (r) {
      start().then(function () {
        toast('Viewing as ' + r.user.name + ' · ' + r.user.role);
      });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.logout = function () {
  flush()
    .then(function () {
      return req('POST', '/auth/logout').catch(function () {});
    })
    .then(function () {
      signOut('You have signed out.');
    });
};
ACT.mfa = function () {
  S.menu = null;
  req('GET', '/auth/me').then(function (r) {
    openModal('mfa', { on: r.mfaEnabled, required: r.mfaRequired });
  });
};
MODALS.mfa = function (m) {
  if (m.on)
    return {
      title: 'Two-step verification',
      size: 'sm2',
      form: m.required ? null : 'mfaOff',
      ok: 'Turn off',
      danger: 1,
      body:
        '<p class="sm">Two-step verification is <b>on</b>. You enter a code from your authenticator app each time you sign in.</p>' +
        (m.required
          ? '<p class="muted sm">It is required for your role and cannot be turned off.</p>'
          : '<div class="fgrid">' +
            F('Password', 'password', { t: 'password', req: 1, full: 1 }) +
            F('Current 6-digit code', 'code', { req: 1, full: 1 }) +
            '</div>'),
    };
  return {
    title: 'Two-step verification',
    size: 'sm2',
    foot: '<button class="btn" data-act="closeModal">Not now</button><button class="btn primary" data-act="mfaStart">Set up</button>',
    body: '<p class="sm">Protect your account with a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) in addition to your password.</p>',
  };
};
ACT.mfaStart = function () {
  closeModal();
  flush().then(function () {
    stageScreen('mfa_setup', 'Scan the QR code with your authenticator app, then enter the 6-digit code.');
  });
};
SUB.mfaOff = function (d, f) {
  if (!need(f, d, ['password', 'code'])) return;
  req('POST', '/auth/mfa/disable', d)
    .then(function () {
      closeModal();
      toast('Two-step verification turned off', 'warn');
    })
    .catch(function (e) {
      setErr(f, 'code', e.message);
    });
};
ACT.chgPwd = function () {
  S.menu = null;
  openModal('chgPwd', {});
};
MODALS.chgPwd = function () {
  return {
    title: 'Change password',
    size: 'sm2',
    form: 'chgPwd',
    ok: 'Change password',
    body:
      '<div class="fgrid">' +
      F('Current password', 'current', { t: 'password', req: 1, full: 1 }) +
      F('New password', 'next', {
        t: 'password',
        req: 1,
        full: 1,
        help: 'At least 10 characters using three of: lower-case, upper-case, digits, symbols.',
      }) +
      '</div>',
  };
};
SUB.chgPwd = function (d, f) {
  if (!need(f, d, ['current', 'next'])) return;
  req('POST', '/auth/change-password', d)
    .then(function () {
      closeModal();
      toast('Password changed – other devices have been signed out', 'ok');
    })
    .catch(function (e) {
      setErr(f, 'next', e.message);
    });
};
var _topbar = window.topbar;
window.topbar = function () {
  var h = _topbar();
  if (!SERVER.impersonation)
    h = h.replace(
      /<div class="lab">Switch demo user \(role preview\)<\/div>[\s\S]*?(?=<div class="lab">Display<\/div>)/,
      '',
    );
  else h = h.replace('Switch demo user (role preview)', 'Role preview (staging)');
  h = h.replace(
    '<div class="lab">Display</div>',
    '<div class="lab">Account</div><div class="mi" data-act="chgPwd">' +
      ic('shield') +
      ' Change password</div><div class="mi" data-act="mfa">' +
      ic('shield') +
      ' Two-step verification</div><div class="mi" data-act="logout">' +
      ic('logout') +
      ' Sign out</div><div class="lab">Display</div>',
  );
  if (modeOf('exotel') === 'live' || SERVER.env === 'production')
    h = h.replace(/<button class="btn sm" data-act="simCall"[\s\S]*?<\/button>/, '');
  return h;
};
var _theme = ACT.theme;
ACT.theme = function () {
  _theme();
  LS.set('lof_theme', S.theme);
};
var _saveFilter = ACT.saveFilter;
ACT.saveFilter = function () {
  _saveFilter();
  LS.set('lof_saved_filters', JSON.stringify(S.saved));
};

// Remove prototype-only simulators from real data screens (the Testing console replaces them)
var _leads = PAGES.leads;
PAGES.leads = function (rt) {
  return _leads(rt).replace(/<button class="btn" data-act="openSimCapture">[\s\S]*?<\/button>/, '');
};
var _lead = PAGES.lead;
PAGES.lead = function (rt) {
  var h = _lead(rt);
  var l = leadById(rt.id);
  if (!l) return h;
  if (SERVER.env === 'production' || modeOf('whatsapp') === 'live')
    h = h.replace(/<button class="btn sm" data-act="mAvail"[^>]*>Simulate parent reply<\/button>/, '');
  if (l.avail && l.avail.s === 'Replied')
    h = h.replace(
      /Parent prefers <b>[^<]*<\/b>\./,
      'Parent replied on WhatsApp: <b>“' + esc(l.avail.text || '') + '”</b>. Schedule the call under Follow-ups.',
    );
  return h;
};
