/* Settings → Testing console. */
GROUPS.find(function (g) {
  return g.id === 'set';
}).tabs.push(['testing', 'Testing console', 'target', 'configuration']);
ACCESS.testing = ['configuration', 'V'];
var TC = {
  status: null,
  loading: false,
  results: {},
  sims: {},
  scen: {},
  logs: null,
  logF: { integration: '', ok: '' },
};
function tcLoad() {
  TC.loading = true;
  return Promise.all([req('GET', '/testing/status'), tcLogs()])
    .then(function (r) {
      TC.status = r[0];
      TC.loading = false;
      safeRender();
    })
    .catch(function (e) {
      TC.loading = false;
      TC.error = e.message;
      safeRender();
    });
}
function tcLogs() {
  var q =
    '?limit=100' +
    (TC.logF.integration ? '&integration=' + TC.logF.integration : '') +
    (TC.logF.ok === '0' ? '&ok=0' : '');
  return req('GET', '/testing/logs' + q).then(function (r) {
    TC.logs = r.items;
  });
}
var SIMS = [
  ['website', 'Website enquiry', 'Signed form submission → lead created, routed, WhatsApp/e-mail queued'],
  ['meta', 'Meta lead form', 'Signed leadgen event → lead imported'],
  ['meta-verify', 'Meta subscription check', 'hub.challenge verification'],
  ['whatsapp-verify', 'WhatsApp subscription check', 'hub.challenge verification'],
  ['whatsapp-status', 'WhatsApp delivered', 'Delivery receipt updates the latest test message'],
  ['whatsapp-inbound', 'WhatsApp reply', 'Parent reply threads onto the test lead'],
  ['exotel-incoming', 'Incoming call', 'Caller identified, screen-pop raised'],
  ['exotel-status', 'Call completed', 'Call logged, first-call SLA stopped'],
  ['telr-paid', 'Telr payment', 'Transaction advice → verified → receipt (needs an open test link)'],
  ['razorpay-paid', 'Razorpay payment', 'payment_link.paid → receipt (needs an open test link)'],
  ['bad-signature', 'Forged webhook', 'Invalid signature must be rejected with 401'],
];
var SCEN = [
  [
    'uae-lead-to-enrolment',
    'UAE: enquiry → enrolment → Telr payment',
    'Website lead, routing, messages, Exotel call, conversion, enrolment, LMS enrol call, Telr, receipt, ERPNext, idempotency, withdrawal with refund suggestion and LMS cancel call',
  ],
  [
    'india-lead-to-enrolment',
    'India: enquiry → enrolment → Razorpay payment',
    'Same flow for Bengaluru with INR and Razorpay',
  ],
  ['meta-lead', 'Meta Lead Ads import', 'Signed leadgen webhook and forged-signature rejection'],
  [
    'lms-failure-retry',
    'LMS outage and retry',
    'The failed enrol call is recorded; the retry succeeds (mock mode only)',
  ],
];
var resBadge = function (r) {
  if (!r) return '<span class="faint">—</span>';
  if (r.running) return bdg('Running…', 'info');
  return r.ok
    ? bdg('Passed' + (r.mode ? ' · ' + r.mode : ''), r.mode === 'mock' ? 'warn' : 'ok')
    : bdg('Failed', 'crit');
};
PAGES.testing = function () {
  if (!TC.status && !TC.loading && !TC.error) tcLoad();
  if (!TC.status)
    return (
      ph('Testing console', 'Integration readiness, webhook simulations and end-to-end scenarios') +
      card('', TC.error ? emptyBox('Could not load', TC.error) : emptyBox('Loading…', ''))
    );
  var st = TC.status;
  var head = ph(
    'Testing console',
    'Check every integration before go-live. Simulations and scenarios create <b>test records only</b> (IDs start with TST-) and never touch business numbering.',
    '<button class="btn" data-act="tcRefresh">' +
      ic('refresh') +
      ' Refresh</button><button class="btn" data-act="tcCron">' +
      ic('clock') +
      ' Run scheduler now</button><button class="btn danger" data-act="tcCleanup">Delete test data (' +
      st.testRecords +
      ')</button>',
  );
  var info =
    '<div class="sum"><div class="it"><small>Environment</small><b>' +
    esc(st.env) +
    '</b></div><div class="it"><small>Integration mode</small>' +
    (st.forcedMock ? bdg('Forced mock', 'warn') : bdg('Auto (live when enabled + configured)', 'info')) +
    '</div><div class="it"><small>Background jobs</small>' +
    (st.queue ? bdg('Cloudflare Queue', 'ok') : bdg('In-request (no queue bound)', 'warn')) +
    '</div><div class="it"><small>Live integrations</small><b>' +
    st.integrations.filter(function (i) {
      return i.mode === 'live';
    }).length +
    ' / ' +
    st.integrations.length +
    '</b></div></div>';
  var integ = card(
    'Integration readiness',
    table(
      'tci',
      [
        {
          h: 'Integration',
          f: function (i) {
            return '<b>' + esc(i.label) + '</b>';
          },
        },
        {
          h: 'Configuration',
          f: function (i) {
            return i.enabled ? bdg('Enabled', 'ok') : bdg('Disabled', '');
          },
        },
        {
          h: 'Mode',
          f: function (i) {
            return i.mode === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn');
          },
        },
        {
          h: 'Missing secrets / settings',
          f: function (i) {
            return i.missing.length
              ? '<span class="mono xs" style="color:var(--crit)">' + i.missing.map(esc).join('<br>') + '</span>'
              : bdg('None', 'ok');
          },
        },
        {
          h: 'Webhook URL to register',
          f: function (i) {
            return i.webhooks.length
              ? '<span class="mono xs">' + i.webhooks.map(esc).join('<br>') + '</span>'
              : '<span class="faint">—</span>';
          },
        },
        {
          h: 'Last activity',
          f: function (i) {
            return i.last
              ? (i.last.ok ? bdg('OK', 'ok') : bdg('Error', 'crit')) +
                  '<div class="muted xs">' +
                  fDT(i.last.at) +
                  ' · ' +
                  esc(i.last.operation) +
                  ' · ' +
                  esc(i.last.mode) +
                  '</div>'
              : '<span class="faint">Never</span>';
          },
        },
        {
          h: 'Connection test',
          f: function (i) {
            var r = TC.results[i.key];
            return (
              '<div class="row"><button class="btn sm" data-act="tcTest" data-k="' +
              i.key +
              '">Test</button>' +
              resBadge(r) +
              '</div>' +
              (r && !r.running
                ? '<div class="xs ' +
                  (r.ok ? 'muted' : '') +
                  '" style="max-width:260px;overflow-wrap:anywhere;' +
                  (r.ok ? '' : 'color:var(--crit)') +
                  '">' +
                  esc(r.ok ? (r.note || JSON.stringify(r.detail || '')).slice(0, 160) : r.error) +
                  '</div>'
                : '')
            );
          },
        },
      ],
      st.integrations,
      { all: 1 },
    ),
    { np: 1, act: '<button class="btn sm" data-act="tcTestAll">Test all</button>' },
  );
  var sims = card(
    'Webhook simulations',
    '<p class="muted sm" style="margin-top:0">Each simulation builds a correctly signed provider event and sends it through the real webhook endpoint.</p><div class="grid g3">' +
      SIMS.map(function (s) {
        var r = TC.sims[s[0]];
        return (
          '<div class="card"><div class="bd"><div class="row" style="justify-content:space-between"><b>' +
          esc(s[1]) +
          '</b>' +
          resBadge(r) +
          '</div><div class="muted xs" style="margin:4px 0 8px">' +
          esc(s[2]) +
          '</div><button class="btn sm" data-act="tcSim" data-k="' +
          s[0] +
          '">Send</button>' +
          (r && !r.running
            ? '<div class="mono xs" style="margin-top:6px;max-height:80px;overflow:auto;overflow-wrap:anywhere;' +
              (r.ok ? '' : 'color:var(--crit)') +
              '">' +
              esc(r.text) +
              '</div>'
            : '') +
          '</div></div>'
        );
      }).join('') +
      '</div>',
  );
  var scen = card(
    'End-to-end scenarios',
    '<div class="grid g2">' +
      SCEN.map(function (s) {
        var r = TC.scen[s[0]];
        return (
          '<div class="card"><div class="hd"><h3>' +
          esc(s[1]) +
          '</h3><div class="row">' +
          resBadge(r) +
          '<button class="btn sm primary" data-act="tcScen" data-k="' +
          s[0] +
          '">Run</button></div></div><div class="bd"><div class="muted xs" style="margin-bottom:8px">' +
          esc(s[2]) +
          '</div>' +
          (r && r.steps
            ? '<div class="tl">' +
              r.steps
                .map(function (x) {
                  return (
                    '<div class="ev ' +
                    (x.ok ? 'msg' : 'crit') +
                    '"><div>' +
                    (x.ok ? '✓ ' : '✗ ') +
                    esc(x.step) +
                    '</div><div class="t" style="overflow-wrap:anywhere">' +
                    x.ms +
                    ' ms · ' +
                    esc(typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail)).slice(0, 220) +
                    '</div></div>'
                  );
                })
                .join('') +
              '</div>' +
              (r.error ? '<div class="fe">' + esc(r.error) + '</div>' : '')
            : '<span class="faint xs">Not run yet</span>') +
          '</div></div>'
        );
      }).join('') +
      '</div>',
  );
  var flags = card(
    'Failure injection (mock mode)',
    '<label class="chk"><input type="checkbox" data-change="tcFlag" data-k="moodleFail"' +
      (st.flags && st.flags.moodleFail ? ' checked' : '') +
      '> Simulate LMS outage – new LMS calls fail until switched off</label>',
  );
  var logs = card(
    'Integration log',
    '<div class="tb"><select data-change="tcLogF" name="integration" aria-label="Integration"><option value="">All integrations</option>' +
      Object.keys(INTEG_LABEL)
        .map(function (k) {
          return (
            '<option value="' +
            k +
            '"' +
            (TC.logF.integration === k ? ' selected' : '') +
            '>' +
            INTEG_LABEL[k] +
            '</option>'
          );
        })
        .join('') +
      '</select><select data-change="tcLogF" name="ok" aria-label="Result"><option value="">All results</option><option value="0"' +
      (TC.logF.ok === '0' ? ' selected' : '') +
      '>Failures only</option></select><span class="muted xs" style="margin-left:auto">Secrets are redacted before logging.</span></div>' +
      table(
        'tcl',
        [
          {
            h: 'Time',
            f: function (l) {
              return fDT(l.at);
            },
          },
          {
            h: 'Integration',
            f: function (l) {
              return esc(INTEG_LABEL[l.integration] || l.integration);
            },
          },
          {
            h: 'Direction',
            f: function (l) {
              return l.direction === 'in' ? 'Inbound' : 'Outbound';
            },
          },
          {
            h: 'Operation',
            f: function (l) {
              return '<span class="mono xs">' + esc(l.operation) + '</span>';
            },
          },
          {
            h: 'Mode',
            f: function (l) {
              return l.mode === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn');
            },
          },
          {
            h: 'Result',
            f: function (l) {
              return l.ok ? bdg(String(l.status || 'OK'), 'ok') : bdg(String(l.status || 'Error'), 'crit');
            },
          },
          {
            h: 'ms',
            f: function (l) {
              return l.duration_ms == null ? '—' : l.duration_ms;
            },
            r: 1,
          },
          {
            h: 'Reference',
            f: function (l) {
              return (
                '<span class="mono xs">' + esc(l.ref || '') + '</span>' + (l.is_test ? ' ' + bdg('test', 'info') : '')
              );
            },
          },
        ],
        TC.logs || [],
        {
          ps: 15,
          row: function (l) {
            return 'data-act="tcLog" data-id="' + l.id + '"';
          },
          et: 'No integration calls yet',
        },
      ),
    { np: 1 },
  );
  var suite = card(
    'Automated test suite',
    '<p class="sm" style="margin-top:0">Run before every deployment: <span class="mono">npm test</span> (78 tests: unit, API & permission guard, webhooks, live adapters against stubbed provider APIs, testing console scenarios) and <span class="mono">npm run test:e2e</span> (browser tests of the screens against a local server).</p>',
  );
  return (
    head +
    info +
    integ +
    '<div style="height:14px"></div>' +
    scen +
    '<div style="height:14px"></div>' +
    sims +
    '<div style="height:14px"></div><div class="grid g2">' +
    flags +
    suite +
    '</div><div style="height:14px"></div>' +
    logs
  );
};
ACT.tcRefresh = function () {
  TC.status = null;
  TC.error = null;
  render();
};
ACT.tcTest = function (d) {
  TC.results[d.k] = { running: true };
  render();
  return req('POST', '/testing/integrations/' + d.k + '/test')
    .then(function (r) {
      TC.results[d.k] = r;
    })
    .catch(function (e) {
      TC.results[d.k] = { ok: false, error: e.message };
    })
    .then(tcLogs)
    .then(function () {
      req('GET', '/testing/status').then(function (s) {
        TC.status = s;
        safeRender();
      });
    });
};
ACT.tcTestAll = function () {
  TC.status.integrations.reduce(function (p, i) {
    return p.then(function () {
      return ACT.tcTest({ k: i.key });
    });
  }, Promise.resolve());
};
ACT.tcSim = function (d) {
  TC.sims[d.k] = { running: true };
  render();
  req('POST', '/testing/webhooks/' + d.k + '/simulate', {})
    .then(function (r) {
      TC.sims[d.k] = {
        ok: r.ok !== false && (r.status ? r.status < 400 || d.k === 'bad-signature' : true),
        text: 'HTTP ' + r.status + ' ' + (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      };
    })
    .catch(function (e) {
      TC.sims[d.k] = { ok: false, text: e.message };
    })
    .then(function () {
      return Promise.all([
        tcLogs(),
        req('GET', '/testing/status').then(function (s) {
          TC.status = s;
        }),
      ]);
    })
    .then(function () {
      reload(true);
    });
};
ACT.tcScen = function (d) {
  TC.scen[d.k] = { running: true };
  render();
  req('POST', '/testing/scenarios/' + d.k + '/run')
    .then(function (r) {
      TC.scen[d.k] = r;
    })
    .catch(function (e) {
      TC.scen[d.k] = { ok: false, error: e.message, steps: [] };
    })
    .then(function () {
      return Promise.all([
        tcLogs(),
        req('GET', '/testing/status').then(function (s) {
          TC.status = s;
        }),
      ]);
    })
    .then(function () {
      reload(true);
    });
};
ACT.tcCron = function () {
  req('POST', '/testing/cron')
    .then(function (r) {
      toast(
        'Scheduler ran: ' +
          r.leadsChecked +
          ' open leads checked, ' +
          (r.overdueInstalments || 0) +
          ' overdue instalment(s) notified, ' +
          (r.lmsRetries || 0) +
          ' LMS retries queued',
        'ok',
      );
      reload(true);
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.tcCleanup = function () {
  confirmBox(
    'Delete test data',
    'Delete all records created by simulations and scenarios (IDs starting with TST-) and their logs? Business records are not affected.',
    'tcCleanup',
    null,
    'Delete test data',
    1,
  );
};
CONFIRM.tcCleanup = function () {
  req('POST', '/testing/cleanup')
    .then(function (r) {
      toast(r.deleted + ' test records deleted', 'ok');
      TC.status = null;
      TC.scen = {};
      TC.sims = {};
      reload(true);
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
CHG.tcFlag = function (el) {
  var b = {};
  b[el.dataset.k] = el.checked;
  req('POST', '/testing/flags', b).then(function () {
    TC.status.flags = Object.assign({}, TC.status.flags, b);
    toast('Failure injection ' + (el.checked ? 'on' : 'off'), 'warn');
  });
};
CHG.tcLogF = function (el) {
  TC.logF[el.name] = el.value;
  tcLogs().then(function () {
    render();
  });
};
ACT.tcLog = function (d) {
  req('GET', '/testing/logs/' + d.id).then(function (l) {
    openModal('tcLog', { l: l });
  });
};
MODALS.tcLog = function (m) {
  var l = m.l;
  var pretty = function (s) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch (e) {
      return s || '';
    }
  };
  var pre = function (s) {
    return (
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:10px;font-family:var(--f-mono);font-size:11.5px;max-height:260px;overflow:auto">' +
      esc(pretty(s)) +
      '</pre>'
    );
  };
  return {
    title: (INTEG_LABEL[l.integration] || l.integration) + ' · ' + l.operation,
    size: 'lg',
    foot: '<button class="btn" data-act="closeModal">Close</button>',
    body:
      dl([
        ['Time', fDT(l.at)],
        ['Direction', l.direction === 'in' ? 'Inbound webhook' : 'Outbound API call'],
        ['Mode', l.mode],
        ['Request', esc((l.method || '') + ' ' + (l.url || ''))],
        [
          'Result',
          (l.ok ? 'OK' : 'Failed') +
            (l.status ? ' · HTTP ' + l.status : '') +
            (l.duration_ms != null ? ' · ' + l.duration_ms + ' ms' : ''),
        ],
        ['Error', esc(l.error || '')],
        ['Reference', esc(l.ref || '')],
      ]) +
      '<div class="sec">Request</div>' +
      pre(l.request) +
      '<div class="sec">Response</div>' +
      pre(l.response),
  };
};
