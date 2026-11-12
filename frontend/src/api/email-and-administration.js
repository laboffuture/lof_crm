// ------------------------------------------------------------------ Configuration → Email Templates (after Communication)
CTABS.splice(
  CTABS.findIndex(function (t) {
    return t[0] === 'comms';
  }) + 1,
  0,
  ['emailTpls', 'Email Templates'],
);
var ET = { cat: '', q: '' },
  etLastField = 'body';
function etMeta() {
  return SERVER.emailTemplates || { categories: [], placeholders: {} };
}
function etList() {
  return S.cfg.emailTpls || (S.cfg.emailTpls = []);
}
function etById(id) {
  return etList().find(function (t) {
    return t.id === id;
  });
}
function etBranch(id) {
  if (id === 'All') return 'All branches';
  var b = (S.branches || []).find(function (x) {
    return x.id === id;
  });
  return b ? b.name : id;
}
function etSample(s) {
  var p = etMeta().placeholders;
  return String(s).replace(/\{(\w+)\}/g, function (all, k) {
    return p[k] ? p[k].sample : all;
  });
}
CFG.emailTpls = function () {
  var meta = etMeta(),
    edit = can('configuration', 'E'),
    q = ET.q.toLowerCase(),
    all = etList();
  var rows = all.filter(function (t) {
    return (
      (!ET.cat || t.cat === ET.cat) && (!q || (t.n + ' ' + t.subject + ' ' + t.body).toLowerCase().indexOf(q) >= 0)
    );
  });
  var cats =
    '<div class="chips" style="margin-bottom:12px">' +
    ['']
      .concat(meta.categories)
      .map(function (c) {
        var n = all.filter(function (t) {
          return !c || t.cat === c;
        }).length;
        return (
          '<a class="chip' +
          (ET.cat === c ? ' on' : '') +
          '" data-act="etCat" data-c="' +
          esc(c) +
          '" tabindex="0">' +
          esc(c || 'All') +
          ' <span class="muted xs">' +
          n +
          '</span></a>'
        );
      })
      .join('') +
    '</div>';
  var search =
    '<div class="tb" style="border:0;padding:0 0 12px"><input type="search" id="etq" data-input="etq" placeholder="Search name, subject or message" value="' +
    esc(ET.q) +
    '" aria-label="Search e-mail templates" style="min-width:min(100%,300px)"></div>';
  var list = rows.length
    ? table(
        'etpl',
        [
          {
            h: 'Template',
            f: function (t) {
              return '<b>' + esc(t.n) + '</b><div class="muted xs">' + esc(t.cat) + '</div>';
            },
            s: function (t) {
              return t.cat + ' ' + t.n;
            },
          },
          {
            h: 'Subject',
            f: function (t) {
              return '<span class="sm">' + esc(t.subject) + '</span>';
            },
          },
          {
            h: 'Branch',
            f: function (t) {
              return esc(etBranch(t.branch));
            },
            s: function (t) {
              return etBranch(t.branch);
            },
          },
          {
            h: 'Status',
            f: function (t) {
              return bdg(t.active ? 'Active' : 'Inactive', t.active ? 'ok' : '');
            },
          },
          {
            h: '',
            f: function (t) {
              return (
                '<span class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-act="etPreview" data-id="' +
                t.id +
                '">Preview</button>' +
                (edit
                  ? '<button class="btn sm" data-act="etEdit" data-id="' +
                    t.id +
                    '">Edit</button><button class="btn sm ghost" data-act="etCopy" data-id="' +
                    t.id +
                    '">Duplicate</button>'
                  : '') +
                '</span>'
              );
            },
          },
        ],
        rows,
        { all: 1 },
      )
    : emptyBox(
        'No templates',
        ET.q || ET.cat ? 'Clear the search or pick another category.' : 'Add the first template.',
      );
  return (
    card(
      'Email Templates<div class="muted xs" style="font-weight:400">E-mails to parents and clients – fee receipts, reminders, competitions, progress updates and notices.</div>',
      cats + search + list,
      { act: edit ? '<button class="btn sm primary" data-act="etAdd">' + ic('plus') + ' Add template</button>' : '' },
    ) +
    '<p class="muted xs">Placeholders such as {student_name} or {receipt_no} are filled in when an e-mail is sent. A template for one branch is used instead of the “All branches” template with the same name. Automated lead and enrolment messages are under Communication.</p>'
  );
};
ACT.etCat = function (d) {
  ET.cat = d.c || '';
  render();
};
INP.etq = function (el) {
  ET.q = el.value;
  render();
};
ACT.etAdd = function () {
  openModal('etTpl', {});
};
ACT.etEdit = function (d) {
  openModal('etTpl', { id: d.id });
};
ACT.etCopy = function (d) {
  openModal('etTpl', { copy: d.id });
};
ACT.etPreview = function (d) {
  openModal('etPreview', { id: d.id });
};
ACT.etDelete = function (d) {
  var t = etById(d.id);
  if (t)
    confirmBox(
      'Delete template',
      'Delete <b>' + esc(t.n) + '</b>? E-mails already sent are not affected.',
      'etDelete',
      d.id,
      'Delete',
      true,
    );
};
CONFIRM.etDelete = function (id) {
  var t = etById(id);
  if (!t) return;
  S.cfg.emailTpls = etList().filter(function (x) {
    return x.id !== id;
  });
  cfgSave('E-mail template ' + t.n, 'Deleted');
};
// Placeholder chips insert at the cursor of the subject or message field (whichever was used last)
document.addEventListener('focusin', function (e) {
  if (e.target && (e.target.id === 'f_subject' || e.target.id === 'f_body')) etLastField = e.target.id.slice(2);
});
ACT.etIns = function (d) {
  var el = document.getElementById('f_' + etLastField);
  if (!el) return;
  var v = '{' + d.k + '}',
    a = el.selectionStart == null ? el.value.length : el.selectionStart,
    b = el.selectionEnd == null ? a : el.selectionEnd;
  el.value = el.value.slice(0, a) + v + el.value.slice(b);
  el.focus();
  el.selectionStart = el.selectionEnd = a + v.length;
};
MODALS.etTpl = function (m) {
  var meta = etMeta(),
    src = etById(m.id || m.copy);
  var t = src
    ? Object.assign({}, src)
    : { cat: ET.cat || meta.categories[0], n: '', subject: '', body: '', branch: 'All', active: true };
  if (m.copy) t.n = t.n + ' (copy)';
  var chips = Object.keys(meta.placeholders)
    .map(function (k) {
      return (
        '<a class="chip" data-act="etIns" data-k="' +
        k +
        '" tabindex="0" title="' +
        esc(meta.placeholders[k].label) +
        '">{' +
        k +
        '}</a>'
      );
    })
    .join('');
  return {
    title: m.id ? 'Edit e-mail template' : 'Add e-mail template',
    size: 'lg',
    form: 'etTpl',
    foot:
      '<button class="btn" type="button" data-act="closeModal">Cancel</button>' +
      (m.id
        ? '<button class="btn danger" type="button" data-act="etDelete" data-id="' + esc(m.id) + '">Delete</button>'
        : '') +
      '<button class="btn primary" type="submit" form="mform">Save template</button>',
    body:
      '<input type="hidden" name="oid" value="' +
      esc(m.id || '') +
      '"><div class="fgrid">' +
      F('Category', 'cat', { v: t.cat, opts: meta.categories, req: 1 }) +
      F('Template name', 'n', { v: t.n, req: 1, ph: 'e.g. Fee receipt' }) +
      F('Branch', 'branch', {
        v: t.branch,
        opts: [['All', 'All branches']].concat(
          (S.branches || []).map(function (b) {
            return [b.id, b.name];
          }),
        ),
      }) +
      CK('Active – available for sending', 'active', t.active) +
      F('Subject', 'subject', { v: t.subject, req: 1, full: 1 }) +
      F('Message', 'body', {
        t: 'textarea',
        rows: 12,
        v: t.body,
        req: 1,
        full: 1,
        help: 'Plain text. Blank lines start a new paragraph.',
      }) +
      '<div class="f full"><label>Placeholders – click to insert at the cursor</label><div class="chips">' +
      chips +
      '</div></div></div>',
  };
};
SUB.etTpl = function (d, f) {
  if (!need(f, d, ['n', 'subject', 'body'])) return;
  var known = etMeta().placeholders,
    name = d.n.trim(),
    branch = d.branch || 'All';
  var unknown = function (s) {
    return (String(s).match(/\{[^{}]*\}/g) || [])
      .map(function (p) {
        return p.slice(1, -1);
      })
      .find(function (k) {
        return !known[k];
      });
  };
  var bs = unknown(d.subject),
    bb = unknown(d.body);
  if (bs !== undefined) {
    setErr(f, 'subject', 'Unknown placeholder {' + bs + '}');
    return;
  }
  if (bb !== undefined) {
    setErr(f, 'body', 'Unknown placeholder {' + bb + '}');
    return;
  }
  if (
    etList().some(function (t) {
      return t.id !== d.oid && t.n.toLowerCase() === name.toLowerCase() && t.branch === branch;
    })
  ) {
    setErr(f, 'n', 'A template with this name already exists for this branch');
    return;
  }
  var o = { cat: d.cat, n: name, subject: d.subject.trim(), body: d.body, branch: branch, active: !!d.active };
  if (d.oid) Object.assign(etById(d.oid), o);
  else {
    var next =
      etList().reduce(function (mx, t) {
        return Math.max(mx, +String(t.id).replace(/\D/g, '') || 0);
      }, 0) + 1;
    etList().push(Object.assign({ id: 'ET' + next }, o));
  }
  closeModal();
  cfgSave('E-mail template ' + name, o.cat + ' · ' + etBranch(branch));
};
MODALS.etPreview = function (m) {
  var t = etById(m.id) || {},
    p = etMeta().placeholders;
  return {
    title: 'Preview – ' + (t.n || ''),
    size: 'lg',
    foot:
      '<button class="btn" data-act="closeModal">Close</button>' +
      (can('configuration', 'E')
        ? '<button class="btn primary" data-act="etEdit" data-id="' + esc(t.id) + '">Edit</button>'
        : ''),
    body:
      '<p class="muted xs" style="margin-top:0">Shown with sample values. Real e-mails use the student’s and parent’s details.</p>' +
      '<div style="border:1px solid var(--bd);border-radius:8px;overflow:hidden"><div style="padding:10px 14px;border-bottom:1px solid var(--bd)">' +
      '<div class="muted xs">To: ' +
      esc(p.parent_name ? p.parent_name.sample : '') +
      '</div><b>' +
      esc(etSample(t.subject || '')) +
      '</b></div>' +
      '<div class="sm" style="padding:14px;white-space:pre-wrap;line-height:1.55">' +
      esc(etSample(t.body || '')) +
      '</div></div>',
  };
};

// ------------------------------------------------------------------ Configuration → Email Outgoing / Email Incoming
CTABS.splice(
  CTABS.findIndex(function (t) {
    return t[0] === 'emailTpls';
  }) + 1,
  0,
  ['mailOut', 'Email Outgoing'],
  ['mailIn', 'Email Incoming'],
);
var MAIL = { status: null, inbox: null, loading: false, error: null };
var MAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
function mailLoad() {
  if (MAIL.loading) return;
  MAIL.loading = true;
  MAIL.error = null;
  Promise.all([req('GET', '/mail/status'), req('GET', '/mail/inbound')])
    .then(function (r) {
      MAIL.status = r[0];
      MAIL.inbox = r[1].items;
    })
    .catch(function (e) {
      MAIL.error = e.message;
    })
    .then(function () {
      MAIL.loading = false;
      safeRender();
    });
}
function mailReady() {
  if (!MAIL.status && !MAIL.loading && !MAIL.error) mailLoad();
  return !!MAIL.status;
}
var mailKV = function (rows) {
  return (
    '<div class="fgrid">' +
    rows
      .map(function (r) {
        return '<div class="f"><label>' + r[0] + '</label><div>' + r[1] + '</div></div>';
      })
      .join('') +
    '</div>'
  );
};

CFG.mailOut = function () {
  var o = S.cfg.mailOut || {},
    edit = can('configuration', 'E'),
    st = MAIL.status && MAIL.status.outgoing;
  var status = !mailReady()
    ? MAIL.error
      ? emptyBox('Could not load', MAIL.error)
      : emptyBox('Loading…', '')
    : mailKV([
        [
          'Sending through',
          st.smtp && st.smtp.host
            ? '<span class="mono sm">' +
              esc(st.smtp.host + ':' + st.smtp.port) +
              '</span> · ' +
              (st.smtp.security === 'ssl' ? 'SSL' : 'STARTTLS')
            : esc(st.provider),
        ],
        [
          'Mode',
          st.mode === 'live' ? bdg('Live – e-mails are delivered', 'ok') : bdg('Mock – nothing is delivered', 'warn'),
        ],
        ['Sending address', '<span class="mono sm">' + esc(st.from || 'not set') + '</span>'],
        [
          'Still to fill in',
          st.missing.length
            ? '<span class="mono xs" style="color:var(--crit)">' + st.missing.map(esc).join(', ') + '</span>'
            : bdg('None', 'ok'),
        ],
      ]) +
      (o.on === false
        ? '<div class="banner" style="margin-top:12px">' +
          ic('alert') +
          '<span><b>Sending is paused.</b> E-mails are not sent until you turn sending back on.</span></div>'
        : '');
  var form = cfgForm(
    'mailOut',
    swRow(
      'Send e-mails',
      'on',
      o.on !== false,
      'Turn off to pause every e-mail the CRM sends (messages are marked Failed and can be sent again).',
    ) +
      '<div class="fgrid" style="margin-top:12px">' +
      F('Sender name', 'fromName', {
        v: o.fromName,
        req: 1,
        help: 'Shown to parents as the sender, e.g. Lab of Future',
      }) +
      F('Reply-to address', 'replyTo', {
        v: o.replyTo,
        ph: 'ranjith@laboffuture.com',
        help: 'Where parent replies go. Leave empty to use the sending address.',
      }) +
      F('Send a copy (BCC) to', 'bcc', {
        v: o.bcc,
        ph: 'optional',
        help: 'Keeps a copy of every e-mail in this mailbox',
      }) +
      F('Daily sending limit', 'dailyLimit', {
        t: 'number',
        min: 0,
        max: 10000,
        v: o.dailyLimit,
        help: 'Stops sending for the day above this number (0 = no limit). Gmail allows about 2,000 a day.',
      }) +
      F('Signature', 'signature', {
        t: 'textarea',
        rows: 4,
        v: o.signature,
        full: 1,
        ph: 'Lab of Future\n+971 4 000 0000 · laboffuture.com',
        help: 'Added to the end of every e-mail',
      }) +
      '</div>',
  );
  var test =
    '<form data-submit="mailTest" class="row" novalidate style="flex-wrap:wrap;gap:8px"><input type="email" name="to" placeholder="your.name@laboffuture.com" aria-label="Send test e-mail to" style="min-width:min(100%,280px)"><button class="btn primary" type="submit">Send test e-mail</button></form>' +
    '<p class="muted xs">Uses the saved settings above. In mock mode the e-mail is only written to the Integration log.</p>';
  var sm = o.smtp || {};
  var smtpForm =
    '<form data-submit="smtpSave" novalidate autocomplete="off"><div class="fgrid">' +
    F('SMTP server', 'host', {
      v: sm.host || 'smtp.gmail.com',
      req: 1,
      help: 'Google Workspace: smtp.gmail.com · Microsoft 365: smtp.office365.com',
    }) +
    F('Security', 'security', {
      v: sm.security || 'ssl',
      opts: [
        ['ssl', 'SSL/TLS – port 465'],
        ['starttls', 'STARTTLS – port 587'],
      ],
      chg: 'smtpSec',
    }) +
    F('Port', 'port', {
      t: 'number',
      min: 1,
      max: 65535,
      v: sm.port || 465,
      req: 1,
      help: '465 for SSL/TLS, 587 for STARTTLS',
    }) +
    F('Username', 'user', { v: sm.user, req: 1, ph: 'ranjith@laboffuture.com', help: 'The full mailbox address' }) +
    F('Password', 'pass', {
      t: 'password',
      ph: sm.passSet ? '•••••••• saved – leave empty to keep' : 'App password',
      req: !sm.passSet,
      help: 'Google Workspace: a 16-character <b>app password</b> (not the normal password). Stored encrypted on the server and never shown again.',
    }) +
    F('From address', 'from', {
      t: 'email',
      v: sm.from,
      req: 1,
      ph: 'ranjith@laboffuture.com',
      help: 'The mailbox, or an alias it is allowed to send as',
    }) +
    '</div><div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn primary" type="submit">Save SMTP server</button>' +
    (sm.passSet ? '<button class="btn" type="button" data-act="smtpVerify">Check connection</button>' : '') +
    '</div></form>';
  var smtpHelp =
    '<details style="margin-top:14px"><summary class="sm" style="cursor:pointer"><b>How to set up Google Workspace (ranjith@laboffuture.com)</b></summary><ol class="sm" style="line-height:1.7;margin:8px 0 0 18px;padding:0">' +
    '<li>Sign in to <b>myaccount.google.com</b> as ranjith@laboffuture.com.</li>' +
    '<li>Security → turn on <b>2-Step Verification</b> (needed for app passwords).</li>' +
    '<li>Security → <b>App passwords</b> → name it “LOF CRM” → copy the 16-character password.</li>' +
    '<li>Here: server <span class="mono">smtp.gmail.com</span>, SSL/TLS, port <span class="mono">465</span>, username and From address <span class="mono">ranjith@laboffuture.com</span>, paste the app password, Save.</li>' +
    '<li>Click <b>Check connection</b>, then send a test e-mail below.</li></ol>' +
    '<p class="muted xs" style="margin-top:8px">If “App passwords” is missing, the Workspace administrator must allow 2-Step Verification for the account (Admin console → Security → Authentication). Google limits a mailbox to about 2,000 e-mails a day.</p></details>';
  var smtpView = mailKV([
    ['SMTP server', esc((sm.host || '—') + ':' + (sm.port || ''))],
    ['Security', sm.security === 'starttls' ? 'STARTTLS' : 'SSL/TLS'],
    ['Username', esc(sm.user || '—')],
    ['From address', esc(sm.from || '—')],
    ['Password', sm.passSet ? 'Saved' : 'Not set'],
  ]);
  return (
    card('Connection', status, { act: '<button class="btn sm ghost" data-act="mailRefresh">Refresh</button>' }) +
    '<div style="height:14px"></div>' +
    card('SMTP server', edit ? smtpForm + smtpHelp : smtpView) +
    '<div style="height:14px"></div>' +
    card(
      'Sending rules',
      edit
        ? form
        : mailKV([
            ['Sending', o.on === false ? 'Paused' : 'On'],
            ['Sender name', esc(o.fromName)],
            ['Reply-to', esc(o.replyTo || '—')],
            ['Copy to', esc(o.bcc || '—')],
            ['Daily limit', esc(o.dailyLimit)],
          ]),
    ) +
    (edit ? '<div style="height:14px"></div>' + card('Test', test) : '') +
    '<p class="muted xs">These rules apply to every e-mail the CRM sends: lead messages, enrolment welcome, payment links and e-mail templates.</p>'
  );
};
SUB.cfg_mailOut = function (d, f) {
  clearErrs(f);
  if (!need(f, d, ['fromName'])) return;
  if (/[<>"]/.test(d.fromName)) {
    setErr(f, 'fromName', 'Do not use < > or quotes');
    return;
  }
  if (d.replyTo && !MAIL_RE.test(d.replyTo.trim())) {
    setErr(f, 'replyTo', 'Enter a valid e-mail address');
    return;
  }
  if (d.bcc && !MAIL_RE.test(d.bcc.trim())) {
    setErr(f, 'bcc', 'Enter a valid e-mail address');
    return;
  }
  var lim = Number(d.dailyLimit);
  if (!Number.isInteger(lim) || lim < 0 || lim > 10000) {
    setErr(f, 'dailyLimit', 'Whole number from 0 to 10,000');
    return;
  }
  S.cfg.mailOut = {
    on: !!d.on,
    fromName: d.fromName.trim(),
    replyTo: (d.replyTo || '').trim().toLowerCase(),
    bcc: (d.bcc || '').trim().toLowerCase(),
    signature: d.signature || '',
    dailyLimit: lim,
  };
  cfgSave('Email Outgoing', (d.on ? 'Sending on' : 'Sending paused') + ' · limit ' + lim + '/day');
};
SUB.mailTest = function (d) {
  var to = String(d.to || '').trim();
  if (!MAIL_RE.test(to)) {
    toast('Enter a valid e-mail address', 'err');
    return;
  }
  flush()
    .then(function () {
      return req('POST', '/mail/test-send', { to: to });
    })
    .then(function (r) {
      toast(
        r.mode === 'live' ? 'Test e-mail sent to ' + to : 'Mock mode: test e-mail logged, not delivered',
        r.mode === 'live' ? 'ok' : 'warn',
      );
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
CHG.smtpSec = function (el) {
  var p = el.form && el.form.querySelector('[name=port]');
  if (p && (p.value === '465' || p.value === '587' || !p.value)) p.value = el.value === 'ssl' ? '465' : '587';
};
SUB.smtpSave = function (d, f) {
  clearErrs(f);
  var sm = (S.cfg.mailOut || {}).smtp || {};
  if (!need(f, d, sm.passSet ? ['host', 'port', 'user', 'from'] : ['host', 'port', 'user', 'pass', 'from'])) return;
  if (!MAIL_RE.test(String(d.from).trim())) {
    setErr(f, 'from', 'Enter a valid e-mail address');
    return;
  }
  var body = {
    host: String(d.host).trim(),
    port: Number(d.port),
    security: d.security,
    user: String(d.user).trim(),
    from: String(d.from).trim(),
    pass: d.pass || '',
  };
  req('PUT', '/mail/smtp', body)
    .then(function (r) {
      S.cfg.mailOut = Object.assign({}, S.cfg.mailOut || {}, { smtp: r.smtp });
      MAIL.status = null;
      mailLoad();
      toast(
        r.mode === 'live'
          ? 'SMTP server saved – e-mails will now be delivered'
          : r.missing.length
            ? 'Saved – still to fill in: ' + r.missing.join(', ')
            : 'Saved – this server runs in mock mode, so nothing is delivered',
        r.mode === 'live' ? 'ok' : 'warn',
      );
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.smtpVerify = function () {
  toast('Connecting to the mail server…');
  req('POST', '/mail/smtp/verify', {})
    .then(function (r) {
      toast(
        r.mode === 'live'
          ? 'Connected and signed in to ' + r.server
          : 'Settings complete, but this server runs in mock mode (INTEGRATION_MODE=mock) – no connection made',
        r.mode === 'live' ? 'ok' : 'warn',
      );
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.mailRefresh = function () {
  MAIL.status = null;
  MAIL.inbox = null;
  MAIL.error = null;
  mailLoad();
  render();
};

CFG.mailIn = function () {
  var r = S.cfg.mailIn || {},
    edit = can('configuration', 'E'),
    ready = mailReady();
  var brs = (S.branches || []).map(function (b) {
    return [b.id, b.name];
  });
  var progs = (S.programs || []).map(function (p) {
    return [p.id, p.name];
  });
  var conn =
    '<div class="banner">' +
    ic('mail') +
    '<span>' +
    (ready && MAIL.status.incoming.connected
      ? 'Mailbox connected – new e-mails are imported every 5 minutes.'
      : '<b>Mailbox not connected yet.</b> Automatic import starts when the Gmail connection is set up. You can set the rules now and test them with the simulation below.') +
    '</span></div>';
  var form = cfgForm(
    'mailIn',
    swRow('Import incoming e-mail', 'on', !!r.on, 'Read new e-mails from the mailbox and file them in the CRM') +
      swRow(
        'Notify staff when an e-mail arrives',
        'notify',
        r.notify !== false,
        'The counsellor (leads) or the branch team (students) gets a CRM notification',
      ) +
      '<div class="fgrid" style="margin-top:12px">' +
      F('Mailbox', 'mailbox', { v: r.mailbox, ph: 'ranjith@laboffuture.com' }) +
      F('E-mail from an unknown sender', 'unknown', {
        v: r.unknown || 'review',
        opts: [
          ['review', 'Hold for review – notify the Admissions Head'],
          ['lead', 'Create a new lead'],
          ['ignore', 'Ignore'],
        ],
      }) +
      F('Branch for new leads', 'branch', {
        v: r.branch,
        opts: brs,
        blank: '— choose —',
        help: 'Used when unknown senders create a lead',
      }) +
      F('Programme for new leads', 'prog', { v: r.prog, opts: progs, blank: '— choose —' }) +
      F('Blocked senders', 'block', {
        t: 'textarea',
        rows: 4,
        v: (r.block || []).join('\n'),
        full: 1,
        ph: 'spam@example.com\n@marketing-company.com',
        help: 'One address or domain per line. E-mails from these senders are never filed.',
      }) +
      '</div>',
  );
  var how =
    '<ol class="sm" style="margin:0;padding-left:18px;line-height:1.7">' +
    '<li>Sender is a <b>parent on a student record</b> → filed on that student (on each sibling) and the branch team is notified.</li>' +
    '<li>Sender is a <b>lead’s e-mail</b> → filed on the newest open lead and its counsellor is notified.</li>' +
    '<li><b>Unknown sender</b> → held for review, a new lead is created, or ignored (rule above).</li>' +
    '<li>Blocked senders, auto-replies and bounce messages are skipped. The same e-mail is never filed twice.</li></ol>';
  var sim =
    '<form data-submit="mailSim" novalidate><div class="fgrid">' +
    F('From (e-mail)', 'from', { req: 1, ph: 'parent@example.com', id: 'ms_from' }) +
    F('Sender name', 'fromName', { ph: 'optional', id: 'ms_name' }) +
    F('Subject', 'subject', { v: 'Question about the next class', full: 1, id: 'ms_subject' }) +
    F('Message', 'text', {
      t: 'textarea',
      rows: 3,
      v: 'Hello, can you tell me when the next class starts?',
      full: 1,
      id: 'ms_text',
    }) +
    '</div><div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Run simulation</button><span class="muted xs">Uses the saved rules. Use a parent’s address to see it land on their record; leads created here are test records (TST-…).</span></div></form>';
  var rows = MAIL.inbox || [];
  var tone = function (s) {
    return /^Matched|^New lead/.test(s) ? 'ok' : /review/.test(s) ? 'warn' : '';
  };
  var link = function (i) {
    if (!i.ref) return '<span class="faint">—</span>';
    return i.ref
      .split(', ')
      .map(function (id) {
        return (
          '<a class="link" tabindex="0" data-act="go" data-page="' +
          (i.refType === 'student' ? 'student' : 'lead') +
          '" data-id="' +
          esc(id) +
          '">' +
          esc(id) +
          '</a>'
        );
      })
      .join(', ');
  };
  var inbox = !ready
    ? emptyBox(MAIL.error ? 'Could not load' : 'Loading…', MAIL.error || '')
    : rows.length
      ? table(
          'mailin',
          [
            {
              h: 'Received',
              f: function (i) {
                return fDT(i.at || i.receivedAt) + (i.sim ? '<div class="muted xs">Simulation</div>' : '');
              },
              s: function (i) {
                return i.at || i.receivedAt;
              },
            },
            {
              h: 'From',
              f: function (i) {
                return i.fromName ? esc(i.fromName) + '<div class="muted xs">' + esc(i.from) + '</div>' : esc(i.from);
              },
            },
            {
              h: 'Subject',
              f: function (i) {
                return (
                  '<b class="sm">' +
                  esc(i.subject) +
                  '</b><div class="muted xs">' +
                  esc((i.snippet || '').slice(0, 90)) +
                  '</div>'
                );
              },
            },
            {
              h: 'Result',
              f: function (i) {
                return bdg(i.status, tone(i.status));
              },
            },
            { h: 'Filed on', f: link },
          ],
          rows,
          { ps: 10 },
        )
      : emptyBox('No e-mails yet', 'Received e-mails and simulations appear here.');
  return (
    conn +
    card(
      'Filing rules',
      edit
        ? form
        : mailKV([
            ['Import', r.on ? 'On' : 'Off'],
            ['Mailbox', esc(r.mailbox || '—')],
            ['Unknown sender', esc(r.unknown || 'review')],
          ]),
    ) +
    '<div style="height:14px"></div><div class="grid g2" style="align-items:start">' +
    card('How e-mails are filed', how) +
    (edit ? card('Simulate an incoming e-mail', sim) : '') +
    '</div>' +
    '<div style="height:14px"></div>' +
    card('Recent incoming e-mails', inbox, {
      np: rows.length ? 1 : 0,
      act: '<button class="btn sm ghost" data-act="mailRefresh">Refresh</button>',
    })
  );
};
SUB.cfg_mailIn = function (d, f) {
  clearErrs(f);
  if (d.mailbox && !MAIL_RE.test(d.mailbox.trim())) {
    setErr(f, 'mailbox', 'Enter a valid e-mail address');
    return;
  }
  if (d.unknown === 'lead') {
    if (!d.branch) {
      setErr(f, 'branch', 'Choose a branch');
      return;
    }
    var b = (S.branches || []).find(function (x) {
      return x.id === d.branch;
    });
    if (!d.prog || !b || (b.programs || []).indexOf(d.prog) < 0) {
      setErr(f, 'prog', 'Choose a programme offered at this branch');
      return;
    }
  }
  var block = String(d.block || '')
    .split(/[\n,;]+/)
    .map(function (x) {
      return x.trim().toLowerCase();
    })
    .filter(Boolean);
  var bad = block.find(function (x) {
    return !MAIL_RE.test(x) && !/^@?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(x);
  });
  if (bad) {
    setErr(f, 'block', '"' + bad + '" is not an e-mail address or domain');
    return;
  }
  S.cfg.mailIn = {
    on: !!d.on,
    mailbox: (d.mailbox || '').trim().toLowerCase(),
    unknown: d.unknown || 'review',
    branch: d.branch || '',
    prog: d.prog || '',
    block: block,
    notify: !!d.notify,
  };
  cfgSave('Email Incoming', (d.on ? 'Import on' : 'Import off') + ' · unknown senders: ' + S.cfg.mailIn.unknown);
};
SUB.mailSim = function (d, f) {
  clearErrs(f);
  if (!MAIL_RE.test(String(d.from || '').trim())) {
    setErr(f, 'from', 'Enter the sender’s e-mail address');
    return;
  }
  flush()
    .then(function () {
      return req('POST', '/mail/inbound/simulate', {
        from: d.from.trim(),
        fromName: d.fromName || '',
        subject: d.subject || '',
        text: d.text || '',
      });
    })
    .then(function (r) {
      toast(
        'Simulation: ' + r.status + (r.ref ? ' – ' + r.ref : ''),
        /^Matched|^New lead/.test(r.status) ? 'ok' : 'warn',
      );
      MAIL.inbox = null;
      MAIL.status = null;
      mailLoad();
      return reload(false);
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};

// ------------------------------------------------------------------ Configuration → Branches: delete / archive
// A branch with no records is deleted. A branch with records (payments can never be deleted) is archived instead:
// it leaves every list, dropdown and everyone's branch access, its records stay stored, and it can be restored.
var isArchived = function (b) {
  return !!(b && b.archived);
};
var _cfgBranches = CFG.branches;
CFG.branches = function () {
  var all = S.branches,
    html;
  S.branches = all.filter(function (b) {
    return !isArchived(b);
  }); // the table shows active branches only
  try {
    html = _cfgBranches();
  } finally {
    S.branches = all;
  }
  var gone = all.filter(isArchived);
  if (gone.length) {
    html +=
      '<div style="height:14px"></div>' +
      card(
        'Archived branches',
        table(
          'cbArch',
          [
            {
              h: 'Branch',
              f: function (b) {
                return '<b>' + esc(b.name) + '</b><div class="mono muted xs">' + esc(b.code) + '</div>';
              },
            },
            {
              h: 'Country · city',
              f: function (b) {
                return esc(b.country + ' · ' + b.city);
              },
            },
            {
              h: 'Archived',
              f: function (b) {
                return (
                  (b.archivedAt ? fDT(b.archivedAt) : '—') +
                  (b.archivedBy ? '<div class="muted xs">by ' + esc(b.archivedBy) + '</div>' : '')
                );
              },
            },
            {
              h: '',
              f: function (b) {
                return can('configuration', 'D')
                  ? '<button class="btn sm" data-act="restoreBranch" data-id="' + esc(b.id) + '">Restore</button>'
                  : '';
              },
            },
          ],
          gone,
          { all: 1 },
        ),
        { np: 1 },
      ) +
      '<p class="muted xs">Archived branches and their records are hidden from every screen and kept in the database (Settings → Database). Restoring brings them back with status Closed.</p>';
  }
  if (!can('configuration', 'D')) return html;
  return html.replace(
    /(<button class="btn sm" data-act="mBranch" data-id="([^"]+)">Edit<\/button>)/g,
    '<span class="row" style="flex-wrap:nowrap;justify-content:flex-end">$1<button class="btn sm" style="color:var(--crit)" data-act="delBranch" data-id="$2">Delete</button></span>',
  );
};
function branchUse(id) {
  var n = function (arr) {
    return (arr || []).filter(function (x) {
      return x && x.branch === id;
    }).length;
  };
  var use = [
    [n(S.leads), 'leads'],
    [n(S.opps), 'opportunities'],
    [n(S.students), 'students'],
    [n(S.enr), 'enrolments'],
    [n(S.pay), 'payments'],
    [n(S.staff), 'staff'],
    [n(S.fees), 'fee entries'],
  ]
    .filter(function (x) {
      return x[0];
    })
    .map(function (x) {
      return x[0] + ' ' + x[1];
    });
  if ((S.cfg.mailIn || {}).branch === id) use.push('Email Incoming settings');
  if (
    (S.cfg.emailTpls || []).some(function (t) {
      return t.branch === id;
    })
  )
    use.push('Email Templates');
  return use;
}
ACT.delBranch = function (d) {
  var b = S.branches.find(function (x) {
    return x.id === d.id;
  });
  if (!b) return;
  var use = branchUse(b.id);
  if (use.length) {
    if ((S.cfg.mailIn || {}).branch === b.id) {
      toast(b.name + ' receives new leads from e-mail – choose another branch under Email Incoming first', 'err');
      return;
    }
    confirmBox(
      'Delete branch',
      '<b>' +
        esc(b.name) +
        '</b> has records: ' +
        esc(use.join(', ')) +
        '.<br><br>Payments and receipts can never be deleted, so the branch will be <b>removed from every list and from everyone’s branch access</b>, and its records kept safely in the database. You can restore it later under Archived branches.',
      'archiveBranch',
      b.id,
      'Delete branch',
      true,
    );
    return;
  }
  confirmBox(
    'Delete branch',
    'Delete <b>' + esc(b.name) + '</b> (' + esc(b.id) + ')? This cannot be undone.',
    'delBranch',
    b.id,
    'Delete branch',
    true,
  );
};
var afterBranchChange = function () {
  flush()
    .then(function () {
      return reload(false);
    })
    .catch(function () {});
};
CONFIRM.archiveBranch = function (id) {
  var b = S.branches.find(function (x) {
    return x.id === id;
  });
  if (!b) return;
  b.archived = true;
  b.status = 'Closed';
  addAudit('Branch deleted (archived)', id, b.name);
  toast('Branch ' + b.name + ' deleted – its records are kept and can be restored', 'ok');
  render();
  afterBranchChange();
};
ACT.restoreBranch = function (d) {
  var b = S.branches.find(function (x) {
    return x.id === d.id;
  });
  if (!b) return;
  confirmBox(
    'Restore branch',
    'Restore <b>' +
      esc(b.name) +
      '</b>? It comes back with status Closed and its records reappear for users with access to it. Set it to Operating under Edit when it reopens.',
    'restoreBranch',
    b.id,
    'Restore',
  );
};
CONFIRM.restoreBranch = function (id) {
  var b = S.branches.find(function (x) {
    return x.id === id;
  });
  if (!b) return;
  b.archived = false;
  delete b.archivedAt;
  delete b.archivedBy;
  addAudit('Branch restored', id, b.name);
  toast('Branch ' + b.name + ' restored', 'ok');
  render();
  afterBranchChange();
};
// ------------------------------------------------------------------ Configuration → Staff & Users: delete / archive
// A user with no work attached is deleted (login removed). Anyone else is archived: sign-in disabled at once,
// open leads, opportunities and follow-ups move to the Unassigned queue, history keeps their name; restorable.
var _cfgStaff = CFG.staff;
CFG.staff = function () {
  var all = S.staff,
    html;
  S.staff = all.filter(function (s) {
    return !isArchived(s);
  }); // the table shows current users only
  try {
    html = _cfgStaff();
  } finally {
    S.staff = all;
  }
  var gone = all.filter(isArchived);
  if (gone.length) {
    html +=
      '<div style="height:14px"></div>' +
      card(
        'Archived users',
        table(
          'csArch',
          [
            {
              h: 'Name',
              f: function (s) {
                return (
                  '<b>' +
                  esc(s.name) +
                  '</b><div class="muted xs">' +
                  esc(s.emp || '') +
                  ' · ' +
                  esc(s.email || '') +
                  '</div>'
                );
              },
            },
            {
              h: 'Role',
              f: function (s) {
                return esc(s.role);
              },
            },
            {
              h: 'Branch',
              f: function (s) {
                return esc(branchName(s.branch));
              },
            },
            {
              h: 'Archived',
              f: function (s) {
                return (
                  (s.archivedAt ? fDT(s.archivedAt) : '—') +
                  (s.archivedBy ? '<div class="muted xs">by ' + esc(s.archivedBy) + '</div>' : '')
                );
              },
            },
            {
              h: '',
              f: function (s) {
                return can('configuration', 'D')
                  ? '<button class="btn sm" data-act="restoreStaff" data-id="' + esc(s.id) + '">Restore</button>'
                  : '';
              },
            },
          ],
          gone,
          { all: 1 },
        ),
        { np: 1 },
      ) +
      '<p class="muted xs">Archived users cannot sign in. Their name stays on past leads, payments and history. Restoring brings the user back with access disabled – enable it under Edit.</p>';
  }
  if (!can('configuration', 'D')) return html;
  return html.replace(
    /(<button class="btn sm" data-act="mStaff" data-id="([^"]+)">Edit<\/button>)/g,
    '<span class="row" style="flex-wrap:nowrap;justify-content:flex-end">$1<button class="btn sm" style="color:var(--crit)" data-act="delStaff" data-id="$2">Delete</button></span>',
  );
};
function staffUse(id) {
  var count = function (arr, f) {
    return (arr || []).filter(f).length;
  };
  var open = {
    leads: count(S.leads, function (l) {
      return l.cslr === id && l.status === 'Open';
    }),
    opps: count(S.opps, function (o) {
      return o.cslr === id && ['Enrolled', 'Lost'].indexOf(o.stage) < 0;
    }),
    tasks: count(S.tasks, function (t) {
      return t.cslr === id && t.status === 'Pending';
    }),
  };
  var any =
    count(S.leads, function (l) {
      return l.cslr === id;
    }) +
    count(S.opps, function (o) {
      return o.cslr === id;
    }) +
    count(S.tasks, function (t) {
      return t.cslr === id;
    }) +
    count(S.enr, function (e) {
      return e.cslr === id;
    }) +
    count(S.branches, function (b) {
      return b.admin === id;
    });
  return { open: open, any: any };
}
ACT.delStaff = function (d) {
  var s = S.staff.find(function (x) {
    return x.id === d.id;
  });
  if (!s) return;
  if (s.id === S.user) {
    toast('You cannot delete your own user', 'err');
    return;
  }
  var u = staffUse(s.id);
  if (!u.any) {
    confirmBox(
      'Delete user',
      'Delete <b>' + esc(s.name) + '</b> (' + esc(s.email) + ')? Their login is removed. This cannot be undone.',
      'delStaff',
      s.id,
      'Delete user',
      true,
    );
    return;
  }
  var moves = [
    [u.open.leads, 'open lead'],
    [u.open.opps, 'open opportunit'],
    [u.open.tasks, 'pending follow-up'],
  ]
    .filter(function (x) {
      return x[0];
    })
    .map(function (x) {
      return x[0] + ' ' + x[1] + (x[1] === 'open opportunit' ? (x[0] === 1 ? 'y' : 'ies') : x[0] === 1 ? '' : 's');
    });
  confirmBox(
    'Delete user',
    '<b>' +
      esc(s.name) +
      '</b> has work in the CRM, so their name is kept on past records and the user is <b>archived</b>:<ul class="sm" style="margin:8px 0;padding-left:18px">' +
      '<li>Sign-in is disabled immediately and open sessions end.</li>' +
      (moves.length
        ? '<li>' +
          esc(moves.join(', ')) +
          ' move to the <b>Unassigned queue</b> and the Admissions Head is notified.</li>'
        : '') +
      '<li>You can restore the user later under Archived users.</li></ul>',
    'archiveStaff',
    s.id,
    'Delete user',
    true,
  );
};
CONFIRM.delStaff = function (id) {
  var s = S.staff.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  S.staff = S.staff.filter(function (x) {
    return x.id !== id;
  });
  if (S.scope) delete S.scope[id];
  if (S.cfg.targets)
    S.cfg.targets = S.cfg.targets.filter(function (t) {
      return t.c !== id;
    });
  addAudit('User deleted', id, s.name);
  toast(s.name + ' deleted', 'ok');
  render();
};
CONFIRM.archiveStaff = function (id) {
  var s = S.staff.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  s.archived = true;
  s.status = 'Inactive';
  s.access = 'Disabled';
  addAudit('User deleted (archived)', id, s.name);
  toast(s.name + ' deleted – open work moved to the Unassigned queue', 'ok');
  render();
  afterBranchChange();
};
ACT.restoreStaff = function (d) {
  var s = S.staff.find(function (x) {
    return x.id === d.id;
  });
  if (!s) return;
  confirmBox(
    'Restore user',
    'Restore <b>' +
      esc(s.name) +
      '</b>? The user comes back with access disabled; enable it under Edit to let them sign in. Leads moved to the Unassigned queue are not reassigned automatically.',
    'restoreStaff',
    s.id,
    'Restore',
  );
};
CONFIRM.restoreStaff = function (id) {
  var s = S.staff.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  s.archived = false;
  delete s.archivedAt;
  delete s.archivedBy;
  addAudit('User restored', id, s.name);
  toast(s.name + ' restored – enable access under Edit', 'ok');
  render();
  afterBranchChange();
};

// Archived branches and users never appear as a choice in any dropdown (records that still show one keep their selection)
var _renderAll = window.render;
window.render = function () {
  _renderAll.apply(this, arguments);
  if (!S || !S.branches) return;
  var gone = S.branches
    .filter(isArchived)
    .concat((S.staff || []).filter(isArchived))
    .map(function (b) {
      return b.id;
    });
  if (!gone.length) return;
  document.querySelectorAll('select option').forEach(function (o) {
    if (gone.indexOf(o.value) >= 0 && !o.selected) o.remove();
  });
};
CONFIRM.delBranch = function (id) {
  var b = S.branches.find(function (x) {
    return x.id === id;
  });
  if (!b) return;
  S.branches = S.branches.filter(function (x) {
    return x.id !== id;
  });
  Object.keys(S.scope || {}).forEach(function (k) {
    if (Array.isArray(S.scope[k]))
      S.scope[k] = S.scope[k].filter(function (x) {
        return x !== id;
      });
  });
  addAudit('Branch deleted', id, b.name);
  toast('Branch ' + b.name + ' deleted', 'ok');
  render();
};

// ------------------------------------------------------------------ E-mail: individual, bulk and automated
// Send e-mail (Lead / Opportunity / Student pages), Bulk e-mail (Leads, Opportunities, Admissions, Students) and
// Configuration → Email Automation. The server personalises each e-mail, checks branch access and consent,
// records it on the history and sends it with the Email Outgoing rules.
var MS = {};
var MAIL_RES = { lead: 'leads', opp: 'opportunities', student: 'students' };
var canMail = function (res) {
  return can(res, 'E') || can(res, 'C');
};
var uniq = function (a) {
  return a.filter(function (x, i) {
    return x && a.indexOf(x) === i;
  });
};
var latestEnr = function (stuId) {
  return (S.enr || [])
    .filter(function (e) {
      return e.stu === stuId;
    })
    .sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    })[0];
};
var leadOf = function (id) {
  return (S.leads || []).find(function (l) {
    return l.id === id;
  });
};
var MS_SRC = {
  leads: {
    label: 'Leads',
    type: 'lead',
    res: 'leads',
    list: function () {
      return S.leads || [];
    },
    st: function (x) {
      return x.status;
    },
    prog: function (x) {
      return x.prog;
    },
    def: 'Open',
    stLabel: 'Status',
  },
  opps: {
    label: 'Opportunities',
    type: 'opp',
    res: 'opportunities',
    list: function () {
      return S.opps || [];
    },
    st: function (x) {
      return x.stage;
    },
    prog: function (x) {
      return x.prog;
    },
    def: '',
    stLabel: 'Stage',
  },
  adm: {
    label: 'Admissions',
    type: 'opp',
    res: 'opportunities',
    list: function () {
      return (S.opps || []).filter(function (o) {
        return o.stage === 'Admission Decision';
      });
    },
    st: function (x) {
      return x.decision || 'Pending';
    },
    prog: function (x) {
      return x.prog;
    },
    def: '',
    stLabel: 'Decision',
  },
  students: {
    label: 'Students',
    type: 'student',
    res: 'students',
    list: function () {
      return S.students || [];
    },
    st: function (x) {
      return x.status;
    },
    prog: function (x) {
      var e = latestEnr(x.id);
      return e && e.prog;
    },
    def: 'Active',
    stLabel: 'Status',
  },
};
// address the server will use, or '' (the server checks again, including consent and branch access)
function msAddress(type, rec) {
  if (type === 'student') return ((rec.parents || [])[0] || {}).email || '';
  var l = type === 'opp' ? leadOf(rec.lead) : rec;
  if (!l || !l.email) return '';
  return (S.cfg.consentReq || {}).em && !l.em ? '' : l.email;
}
function msRecipients() {
  var recs;
  if (MS.fixed)
    recs = MS.fixed
      .map(function (t) {
        return {
          type: t.type,
          rec:
            t.type === 'lead'
              ? leadOf(t.id)
              : t.type === 'opp'
                ? (S.opps || []).find(function (o) {
                    return o.id === t.id;
                  })
                : (S.students || []).find(function (s) {
                    return s.id === t.id;
                  }),
        };
      })
      .filter(function (x) {
        return x.rec;
      });
  else {
    var src = MS_SRC[MS.src];
    recs = src
      .list()
      .filter(function (x) {
        return (
          (!MS.branch || x.branch === MS.branch) &&
          (!MS.prog || src.prog(x) === MS.prog) &&
          (!MS.status || src.st(x) === MS.status) &&
          !x.test
        );
      })
      .map(function (x) {
        return { type: src.type, rec: x };
      });
  }
  var ok = recs.filter(function (r) {
    return msAddress(r.type, r.rec);
  });
  return {
    targets: ok.map(function (r) {
      return { type: r.type, id: r.rec.id };
    }),
    total: recs.length,
    noMail: recs.length - ok.length,
    recs: recs,
  };
}
var recName = function (r) {
  return r.type === 'student' ? r.rec.first + ' ' + r.rec.last : r.rec.student || r.rec.parent || r.rec.id;
};
function msOpen(o) {
  MS = Object.assign({ src: 'students', branch: '', prog: '', status: '', tpl: '', subject: '', body: '' }, o);
  if (!MS.fixed && MS_SRC[MS.src]) MS.status = MS_SRC[MS.src].def;
  openModal('mailSend', { noFocus: true });
}
ACT.mailOne = function (d) {
  msOpen({ fixed: [{ type: d.t, id: d.id }] });
};
ACT.mailBulk = function (d) {
  msOpen({ src: d.src || 'students' });
};
ACT.mailSel = function () {
  msOpen({
    fixed: Object.keys(S_sel || {}).map(function (id) {
      return { type: 'lead', id: id };
    }),
  });
};
CHG.msAud = function (el) {
  MS[el.name] = el.value;
  if (el.name === 'src') {
    MS.status = MS_SRC[el.value].def;
    MS.prog = '';
  }
  render();
};
CHG.msTpl = function (el) {
  var t = (S.cfg.emailTpls || []).find(function (x) {
    return x.id === el.value;
  });
  MS.tpl = el.value;
  if (t) {
    MS.subject = t.subject;
    MS.body = t.body;
  }
  render();
};
INP.msSubj = function (el) {
  MS.subject = el.value;
};
INP.msBody = function (el) {
  MS.body = el.value;
};
MODALS.mailSend = function () {
  var r = msRecipients(),
    meta = SERVER.emailTemplates || { placeholders: {} };
  var opt = function (v, label, cur) {
    return (
      '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'
    );
  };
  var sel = function (name, label, cur, opts, chg) {
    return (
      '<div class="f"><label for="ms_' +
      name +
      '">' +
      label +
      '</label><select id="ms_' +
      name +
      '" name="' +
      name +
      '" data-change="' +
      (chg || 'msAud') +
      '">' +
      opts
        .map(function (o) {
          return opt(o[0], o[1], cur);
        })
        .join('') +
      '</select></div>'
    );
  };
  var who;
  if (MS.fixed) {
    who =
      '<div class="f full"><label>To</label><div class="sm">' +
      (r.recs.length === 1
        ? esc(recName(r.recs[0])) +
          ' <span class="muted">· ' +
          esc(msAddress(r.recs[0].type, r.recs[0].rec) || 'no e-mail address') +
          '</span>'
        : r.recs.length + ' selected ' + (r.recs[0] && r.recs[0].type === 'lead' ? 'leads' : 'records')) +
      '</div></div>';
  } else {
    var src = MS_SRC[MS.src],
      all = src.list();
    who =
      sel(
        'src',
        'Send to',
        MS.src,
        Object.keys(MS_SRC)
          .filter(function (k) {
            return canMail(MS_SRC[k].res);
          })
          .map(function (k) {
            return [k, MS_SRC[k].label];
          }),
      ) +
      sel(
        'branch',
        'Branch',
        MS.branch,
        [['', 'All branches']].concat(
          (S.branches || [])
            .filter(function (b) {
              return !isArchived(b);
            })
            .map(function (b) {
              return [b.id, b.name];
            }),
        ),
      ) +
      sel(
        'prog',
        'Programme',
        MS.prog,
        [['', 'All programmes']].concat(
          (S.programs || []).map(function (p) {
            return [p.id, p.name];
          }),
        ),
      ) +
      sel(
        'status',
        src.stLabel,
        MS.status,
        [['', 'Any']].concat(
          uniq(all.map(src.st))
            .sort()
            .map(function (s) {
              return [s, s];
            }),
        ),
      );
  }
  var count =
    '<div class="banner" style="margin:4px 0 0">' +
    ic('mail') +
    '<span><b>' +
    r.targets.length +
    ' recipient' +
    (r.targets.length === 1 ? '' : 's') +
    '</b>' +
    (r.noMail ? ' · ' + r.noMail + ' without an e-mail address or consent will be skipped' : '') +
    '. Each person gets their own copy with their details filled in.</span></div>';
  var tpls = (S.cfg.emailTpls || []).filter(function (t) {
    return t.active;
  });
  var chips = Object.keys(meta.placeholders || {})
    .map(function (k) {
      return (
        '<a class="chip" data-act="etIns" data-k="' +
        k +
        '" tabindex="0" title="' +
        esc(meta.placeholders[k].label) +
        '">{' +
        k +
        '}</a>'
      );
    })
    .join('');
  return {
    title: MS.fixed && r.recs.length === 1 ? 'Send e-mail' : 'Bulk e-mail',
    size: 'lg',
    form: 'mailSend',
    foot:
      '<button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="submit" form="mform"' +
      (r.targets.length ? '' : ' disabled') +
      '>' +
      ic('mail') +
      ' Send to ' +
      r.targets.length +
      '</button>',
    body:
      '<div class="fgrid">' +
      who +
      '<div class="f full">' +
      count +
      '</div>' +
      sel(
        'tpl',
        'Template',
        MS.tpl,
        [['', 'No template – write your own']].concat(
          tpls.map(function (t) {
            return [t.id, t.cat + ' · ' + t.n];
          }),
        ),
        'msTpl',
      ) +
      F('Subject', 'subject', { v: MS.subject, req: 1, full: 1, inp: 'msSubj' }) +
      F('Message', 'body', {
        t: 'textarea',
        rows: 10,
        v: MS.body,
        req: 1,
        full: 1,
        inp: 'msBody',
        help: 'Placeholders such as {student_name} are filled in for each recipient.',
      }) +
      '<div class="f full"><label>Placeholders – click to insert at the cursor</label><div class="chips">' +
      chips +
      '</div></div></div>',
  };
};
SUB.mailSend = function (d, f) {
  if (!need(f, d, ['subject', 'body'])) return;
  var r = msRecipients();
  if (!r.targets.length) {
    toast('No recipients with an e-mail address', 'err');
    return;
  }
  var t = (S.cfg.emailTpls || []).find(function (x) {
    return x.id === MS.tpl;
  });
  var btn = document.querySelector('.modal .mf .primary');
  if (btn) btn.disabled = true;
  flush()
    .then(function () {
      return req('POST', '/mail/compose', {
        targets: r.targets,
        template: t ? t.n : 'Composed e-mail',
        subject: d.subject,
        body: d.body,
      });
    })
    .then(function (res) {
      closeModal();
      toast(
        'E-mail sent to ' +
          res.queued +
          (res.skipped.length
            ? ' · ' +
              res.skipped.length +
              ' skipped (' +
              uniq(
                res.skipped.map(function (s) {
                  return s.reason;
                }),
              ).join(', ') +
              ')'
            : ''),
        res.skipped.length ? 'warn' : 'ok',
      );
      if (MS.fixed && MS.fixed[0] && MS.fixed[0].type === 'lead') S_sel = {};
      return reload(true);
    })
    .catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'err');
    });
};
// Buttons on the record and list pages
function mailButtons() {
  if (!S || !S.route) return;
  var rt = S.route,
    head = document.querySelector('#main .ph > .row') || document.querySelector('.ph > .row');
  var one = { lead: 'lead', opp: 'opp', student: 'student' }[rt.page];
  if (one && rt.id && canMail(MAIL_RES[one]) && !document.querySelector('[data-act=mailOne]')) {
    var btn =
      '<button class="btn" data-act="mailOne" data-t="' +
      one +
      '" data-id="' +
      esc(rt.id) +
      '">' +
      ic('mail') +
      ' Send e-mail</button>';
    // record pages without a page header (student, opportunity): at the end of the "List / ID" breadcrumb line
    var crumb =
      !head &&
      Array.prototype.find.call(document.querySelectorAll('#main .muted.sm'), function (x) {
        return x.querySelector('a[data-act=go]') && x.textContent.indexOf(rt.id) >= 0;
      });
    if (head) head.insertAdjacentHTML('afterbegin', btn);
    else if (crumb) {
      crumb.style.cssText += ';display:flex;align-items:center;gap:8px';
      crumb.insertAdjacentHTML('beforeend', '<span style="margin-left:auto">' + btn + '</span>');
    }
  }
  if (head && !head.querySelector('[data-act=mailBulk]')) {
    var bulk = { leads: 'leads', opps: 'opps', admPipeline: 'adm', admDecisions: 'adm', students: 'students' }[rt.page];
    if (bulk && canMail(MS_SRC[bulk].res))
      head.insertAdjacentHTML(
        'afterbegin',
        '<button class="btn" data-act="mailBulk" data-src="' + bulk + '">' + ic('mail') + ' Bulk e-mail</button>',
      );
  }
  if (rt.page === 'leads' && canMail('leads')) {
    var bar = Array.prototype.find.call(document.querySelectorAll('#main .tb'), function (x) {
      var b = x.querySelector('b');
      return b && / selected$/.test(b.textContent);
    });
    if (bar && !bar.querySelector('[data-act=mailSel]'))
      bar
        .querySelector('b')
        .insertAdjacentHTML(
          'afterend',
          '<button class="btn sm" data-act="mailSel">' + ic('mail') + ' Send e-mail</button>',
        );
  }
}
var _renderMail = window.render;
window.render = function () {
  _renderMail.apply(this, arguments);
  try {
    mailButtons();
  } catch (e) {
    /* buttons are optional */
  }
};

// ---------------- Configuration → Email Automation
CTABS.splice(
  CTABS.findIndex(function (t) {
    return t[0] === 'mailIn';
  }) + 1,
  0,
  ['mailAuto', 'Email Automation'],
);
var MA = { log: null, loading: false };
var MA_KINDS = [
  [
    'payRemind',
    'Payment reminders',
    'E-mails the parent before each instalment is due, and once when an instalment becomes overdue.',
  ],
  ['birthday', 'Birthdays', 'Sends birthday wishes to the parents of active students on the birthday.'],
  ['welcome', 'Welcome', 'Welcomes the family after each new enrolment.'],
  [
    'quotation',
    'Quotations',
    'Sends the fee quotation (programme, package, total, valid 14 days) when an admission decision is Accepted.',
  ],
  [
    'receipt',
    'Receipt confirmations',
    'Confirms each payment with the receipt number, amount and balance; the tax invoice follows from accounts.',
  ],
];
function maLoad() {
  if (MA.loading) return;
  MA.loading = true;
  req('GET', '/mail/automation/log')
    .then(function (r) {
      MA.log = r.items;
    })
    .catch(function (e) {
      MA.log = [];
      MA.error = e.message;
    })
    .then(function () {
      MA.loading = false;
      safeRender();
    });
}
CFG.mailAuto = function () {
  var a = S.cfg.mailAuto || {},
    edit = can('configuration', 'E');
  if (!MA.log && !MA.loading) maLoad();
  var names = uniq(
    (S.cfg.emailTpls || [])
      .filter(function (t) {
        return t.active;
      })
      .map(function (t) {
        return t.n;
      }),
  );
  var tplSel = function (name, cur) {
    return F('Template', name, { v: cur, opts: uniq([cur].concat(names)) });
  };
  var hours = [];
  for (var h = 0; h < 24; h++) hours.push([h, (h < 10 ? '0' : '') + h + ':00']);
  var blocks = MA_KINDS.map(function (k) {
    var v = a[k[0]] || {};
    var since = v.on && v.since ? ' Sending since ' + fDT(v.since) + '.' : '';
    return (
      '<div class="sec" style="margin-top:14px">' +
      esc(k[1]) +
      '</div>' +
      swRow('Switched on', 'on_' + k[0], !!v.on, esc(k[2]) + since) +
      '<div class="fgrid" style="margin-top:8px">' +
      tplSel('tpl_' + k[0], v.tpl) +
      (k[0] === 'payRemind'
        ? F('Days before the due date', 'days', {
            v: (v.days || [3]).join(', '),
            help: 'Up to 5 values, for example 7, 3, 1',
          }) +
          '</div>' +
          swRow(
            'Also send an overdue notice',
            'overdue',
            v.overdue !== false,
            'Once per instalment, after the payment term’s grace days',
          ) +
          '<div class="fgrid" style="margin-top:8px">' +
          tplSel('overdueTpl', v.overdueTpl)
        : '') +
      '</div>'
    );
  }).join('');
  var form = cfgForm(
    'mailAuto',
    '<div class="fgrid">' +
      F('Daily send time (Asia/Dubai)', 'hour', {
        v: a.hour,
        opts: hours,
        help: 'Payment reminders and birthday e-mails go out once a day from this time. Welcome, quotation and receipt e-mails go out within about 5 minutes.',
      }) +
      '</div>' +
      blocks,
  );
  var log = !MA.log
    ? emptyBox(MA.error ? 'Could not load' : 'Loading…', MA.error || '')
    : MA.log.length
      ? table(
          'maLog',
          [
            {
              h: 'When',
              f: function (i) {
                return fDT(i.at || i.receivedAt);
              },
              s: function (i) {
                return i.at || i.receivedAt;
              },
            },
            {
              h: 'Automation',
              f: function (i) {
                return esc(
                  (MA_KINDS.find(function (k) {
                    return k[0] === i.kind;
                  }) || [0, i.kind])[1],
                );
              },
            },
            {
              h: 'Record',
              f: function (i) {
                return '<span class="mono xs">' + esc(i.ref || '') + '</span>';
              },
            },
            {
              h: 'To',
              f: function (i) {
                return esc(i.to || '—');
              },
            },
            {
              h: 'Template',
              f: function (i) {
                return esc(i.template || '');
              },
            },
            {
              h: 'Result',
              f: function (i) {
                return bdg(i.status, i.status === 'Queued' ? 'ok' : /^Skipped/.test(i.status) ? 'warn' : '');
              },
            },
          ],
          MA.log,
          { ps: 10 },
        )
      : emptyBox('No automated e-mails yet', 'Switch an automation on; what it sends appears here.');
  return (
    '<div class="banner">' +
    ic('mail') +
    '<span>Automations start switched off. When you switch one on it only covers new events from that moment, so nothing older is sent. Each e-mail goes out once, uses the template you choose (Email Templates) and follows Email Outgoing.</span></div>' +
    card(
      'Automated e-mails',
      edit ? form : emptyBox('View only', 'You need configuration edit access to change automations.'),
    ) +
    '<div style="height:14px"></div>' +
    card('Recent automated e-mails', log, {
      np: MA.log && MA.log.length ? 1 : 0,
      act:
        (edit ? '<button class="btn sm" data-act="mailAutoRun">Run now</button>' : '') +
        '<button class="btn sm ghost" data-act="mailAutoRefresh">Refresh</button>',
    })
  );
};
SUB.cfg_mailAuto = function (d, f) {
  clearErrs(f);
  var days = String(d.days || '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (
    !days.length ||
    days.length > 5 ||
    days.some(function (x) {
      return !Number.isInteger(x) || x < 0 || x > 60;
    })
  ) {
    setErr(f, 'days', 'Up to 5 whole numbers from 0 to 60');
    return;
  }
  var prev = S.cfg.mailAuto || {},
    next = { hour: +d.hour };
  MA_KINDS.forEach(function (k) {
    next[k[0]] = Object.assign({}, prev[k[0]] || {}, { on: !!d['on_' + k[0]], tpl: d['tpl_' + k[0]] });
  });
  Object.assign(next.payRemind, { days: days, overdue: !!d.overdue, overdueTpl: d.overdueTpl });
  var note = '';
  if (next.welcome.on) {
    // the automation replaces the Communication welcome e-mail, so families get one welcome, not two
    var t4 = (S.cfg.comms || []).find(function (t) {
      return t.id === 'T4' && t.ch === 'Email';
    });
    if (t4 && t4.auto) {
      t4.auto = false;
      note = ' – the Communication “Enrolment welcome” e-mail is switched off so families get one welcome';
    }
  }
  S.cfg.mailAuto = next;
  cfgSave(
    'Email Automation',
    MA_KINDS.filter(function (k) {
      return next[k[0]].on;
    })
      .map(function (k) {
        return k[1];
      })
      .join(', ') || 'all off',
  );
  if (note) toast('Saved' + note, 'ok');
  flush().then(function () {
    return reload(true);
  });
};
ACT.mailAutoRefresh = function () {
  MA.log = null;
  MA.error = null;
  maLoad();
  render();
};
ACT.mailAutoRun = function () {
  flush()
    .then(function () {
      return req('POST', '/mail/automation/run', {});
    })
    .then(function (r) {
      toast(
        r.queued ? r.queued + ' automated e-mail' + (r.queued === 1 ? '' : 's') + ' sent' : 'Nothing to send right now',
        r.queued ? 'ok' : 'warn',
      );
      MA.log = null;
      maLoad();
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
