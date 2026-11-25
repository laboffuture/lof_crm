// ---------------- Communication remarks (lead → Communications)
// Every call, WhatsApp and e-mail with the family is listed with its date and time. Remarks can be written or
// changed until 24 hours after the communication (the server enforces the window). After a user's own call or
// message, the remarks window opens by itself.
var REMARK_HOURS = 24;
function canRemark() {
  return can('leads', 'E') || can('leads', 'C');
}
function remarkLeft(r) {
  return REMARK_HOURS * 36e5 - (Date.now() - Date.parse(r.at));
}
function timeLeft(ms) {
  var h = Math.floor(ms / 36e5),
    m = Math.floor((ms % 36e5) / 6e4);
  return h ? h + ' h ' + m + ' min' : m + ' min';
}
function commType(kind, r) {
  if (kind === 'call') return ic('phone') + ' Call · ' + (r.dir === 'Incoming' ? 'incoming' : 'outgoing');
  return (
    ic(r.ch === 'WhatsApp' ? 'chat' : 'mail') +
    ' ' +
    (r.ch === 'Email' ? 'E-mail' : esc(r.ch)) +
    ' · ' +
    (r.inbound ? 'received' : 'sent')
  );
}
function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function commDetail(kind, r, l) {
  if (kind === 'call') {
    return (
      esc(r.status || '') +
      (r.outcome ? ' · ' + esc(r.outcome) : '') +
      ' · ' +
      (+r.dur || 0) +
      ' min' +
      (r.notes ? '<div class="muted xs">' + esc(clip(r.notes, 200)) + '</div>' : '') +
      (r.rec ? '<div class="xs"><a href="' + esc(r.rec) + '" target="_blank" rel="noopener">Recording</a></div>' : '')
    );
  }
  return (
    (r.subj || r.subject ? '<b class="sm">' + esc(r.subj || r.subject) + '</b>' : '') +
    '<div title="' +
    esc(clip(r.text, 1500)) +
    '">' +
    esc(clip(r.text, 240)) +
    '</div>' +
    (l && window.mailReplyBtn ? window.mailReplyBtn('lead', l.id, r) : '')
  );
}
window.remarkCell = function (kind, r) {
  var left = remarkLeft(r),
    open = left > 0,
    mine = canRemark();
  var btn = function (label, primary) {
    return (
      '<button class="btn sm' +
      (primary ? ' primary' : '') +
      '" data-act="remarkOpen" data-k="' +
      kind +
      '" data-id="' +
      esc(r.id) +
      '">' +
      label +
      '</button>'
    );
  };
  if (r.remark) {
    return (
      '<div class="sm" style="white-space:pre-wrap;min-width:180px">' +
      esc(r.remark.text) +
      '</div><div class="muted xs">' +
      esc(r.remark.by) +
      ' · ' +
      fDT(r.remark.at) +
      (r.remark.edited ? ' · edited' : '') +
      '</div>' +
      (open && mine ? '<div style="margin-top:4px">' + btn('Edit') + '</div>' : '')
    );
  }
  if (open)
    return mine
      ? btn('Add remarks', true) + '<div class="muted xs" style="margin-top:3px">' + timeLeft(left) + ' left</div>'
      : '<span class="muted xs">Awaiting remarks</span>';
  return '<span class="faint xs">No remarks – 24-hour window closed</span>';
};
function leadCommRows(l) {
  return (S.calls || [])
    .filter(function (c) {
      return c.lead === l.id;
    })
    .map(function (c) {
      return { kind: 'call', r: c };
    })
    .concat(
      (S.comms || [])
        .filter(function (c) {
          return c.lead === l.id;
        })
        .map(function (c) {
          return { kind: 'comm', r: c };
        }),
    )
    .sort(function (a, b) {
      return new Date(b.r.at) - new Date(a.r.at);
    });
}
window.commTable = function (l) {
  var rows = leadCommRows(l);
  var due = rows.filter(function (x) {
    return !x.r.remark && remarkLeft(x.r) > 0;
  }).length;
  var by = function (x) {
    if (x.kind === 'call') return esc(staffName(x.r.by) || x.r.by || '—');
    return (
      bdg(x.r.status, String(x.r.status).indexOf('Blocked') === 0 ? 'crit' : x.r.inbound ? 'ok' : 'info') +
      '<div class="muted xs">' +
      esc(x.r.by || '') +
      '</div>'
    );
  };
  return (
    (due && canRemark()
      ? '<div class="banner" style="margin:12px 14px 0">' +
        ic('alert') +
        '<span><b>' +
        due +
        '</b> communication' +
        (due === 1 ? '' : 's') +
        ' still need' +
        (due === 1 ? 's' : '') +
        ' remarks. Remarks can be written up to 24 hours after each call or message.</span></div>'
      : '') +
    table(
      'lcommAll',
      [
        {
          h: 'Date & time',
          f: function (x) {
            return fDT(x.r.at) + '<div class="muted xs">' + rel(x.r.at) + '</div>';
          },
        },
        {
          h: 'Type',
          f: function (x) {
            return '<span style="white-space:nowrap">' + commType(x.kind, x.r) + '</span>';
          },
        },
        {
          h: 'Details',
          f: function (x) {
            return commDetail(x.kind, x.r, l);
          },
        },
        { h: 'Status / by', f: by },
        {
          h: 'Remarks',
          f: function (x) {
            return window.remarkCell(x.kind, x.r);
          },
        },
      ],
      rows,
      { all: 1, et: 'No communication yet', ed: 'Calls, WhatsApp messages and e-mails with this family appear here.' },
    )
  );
};
function findRec(k, id) {
  return ((k === 'call' ? S.calls : S.comms) || []).find(function (x) {
    return x.id === id;
  });
}
ACT.remarkOpen = function (d) {
  openModal('remark', { k: d.k, id: d.id });
};
MODALS.remark = function (m) {
  var r = findRec(m.k, m.id);
  if (!r) return { title: 'Communication not found', body: '' };
  var l = leadById(r.lead),
    left = remarkLeft(r),
    until = new Date(Date.parse(r.at) + REMARK_HOURS * 36e5).toISOString();
  return {
    title: (r.remark ? 'Edit remarks' : 'Add remarks') + (l ? ' – ' + l.student : ''),
    form: 'remark',
    size: 'sm2',
    body:
      '<input type="hidden" name="k" value="' +
      esc(m.k) +
      '"><input type="hidden" name="id" value="' +
      esc(m.id) +
      '">' +
      (m.auto
        ? '<p class="sm" style="margin-top:0">Add your remarks on this ' +
          (m.k === 'call' ? 'call' : 'message') +
          ' while it is fresh.</p>'
        : '') +
      '<div class="card" style="margin-bottom:12px"><div class="bd">' +
      dl([
        ['Communication', commType(m.k, r)],
        ['When', fDT(r.at)],
        ['With', l ? esc(l.parent) + ' · <span class="mono">' + esc(l.phone) + '</span>' : '—'],
        ['Details', commDetail(m.k, r, null)],
      ]) +
      '</div></div>' +
      (left <= 0
        ? '<div class="banner" style="background:var(--crit-bg);color:var(--crit)">The 24-hour window for remarks on this communication has closed.</div>'
        : '<div class="f"><label for="rmText">Remarks *</label><textarea id="rmText" name="text" rows="5" maxlength="1000" placeholder="What was discussed, what the parent said, the next step…">' +
          esc(r.remark ? r.remark.text : '') +
          '</textarea></div>' +
          '<p class="muted xs">Remarks can be written or changed until <b>' +
          fDT(until) +
          '</b> (24 hours after the communication).</p>'),
    foot:
      '<button class="btn" data-act="closeModal">' +
      (m.auto ? 'Later' : 'Cancel') +
      '</button>' +
      (left > 0 ? '<button class="btn primary" type="submit" form="mform">Save remarks</button>' : ''),
  };
};
SUB.remark = function (d) {
  var r = findRec(d.k, d.id);
  if (!r) return;
  var text = String(d.text || '').trim();
  if (text.length < 3) {
    toast('Write the remarks first (at least 3 characters)', 'err');
    return;
  }
  var btn = document.querySelector('.modal button[type=submit]');
  if (btn) btn.disabled = true;
  flush()
    .then(function () {
      return req('POST', '/leads/' + encodeURIComponent(r.lead) + '/remarks', { kind: d.k, rec: d.id, text: text });
    })
    .then(function (res) {
      mergeDocs([
        { coll: d.k === 'call' ? 'calls' : 'comms', doc: res.rec },
        { coll: 'leads', doc: res.lead },
      ]);
      closeModal();
      toast('Remarks saved', 'ok');
      render();
    })
    .catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'err');
    });
};
// After the user's own call or message, open the remarks window (once per record). Calls through Exotel arrive with
// the next refresh; a bulk e-mail is not a conversation, so its copies are not prompted one by one.
var RM_SINCE = Date.now() - 2 * 60 * 1000,
  rmSeen = {};
try {
  JSON.parse(LS.get('lof_rm_prompted') || '[]').forEach(function (k) {
    rmSeen[k] = 1;
  });
} catch (e) {
  /* ignore */
}
function rmMark(k) {
  rmSeen[k] = 1;
  try {
    LS.set('lof_rm_prompted', JSON.stringify(Object.keys(rmSeen).slice(-300)));
  } catch (e) {
    /* ignore */
  }
}
function remarkPrompt() {
  if (!S || !S.user || S.modal || userIsTyping() || !canRemark() || document.visibilityState !== 'visible') return;
  var u = me();
  if (!u) return;
  var fresh = function (r) {
    return !r.remark && Date.parse(r.at) >= RM_SINCE && remarkLeft(r) > 0;
  };
  var cands = [];
  (S.calls || []).forEach(function (c) {
    if (c.by === u.id && fresh(c) && !rmSeen['call:' + c.id]) cands.push({ k: 'call', r: c });
  });
  var groups = {};
  (S.comms || []).forEach(function (c) {
    if (c.inbound || c.by !== u.name || !fresh(c) || rmSeen['comm:' + c.id]) return;
    var g = c.ch + '|' + (c.subj || '') + '|' + String(c.at).slice(0, 16);
    (groups[g] = groups[g] || []).push(c);
  });
  Object.keys(groups).forEach(function (g) {
    if (groups[g].length > 1)
      groups[g].forEach(function (c) {
        rmMark('comm:' + c.id);
      });
    else cands.push({ k: 'comm', r: groups[g][0] });
  });
  if (!cands.length) return;
  cands.sort(function (a, b) {
    return new Date(a.r.at) - new Date(b.r.at);
  });
  var x = cands[0];
  rmMark(x.k + ':' + x.r.id);
  openModal('remark', { k: x.k, id: x.r.id, auto: true });
}
setInterval(function () {
  try {
    remarkPrompt();
  } catch (e) {
    /* never block the screens */
  }
}, 2500);
// ------------------------------------------------------------------ conversation log (lead → Activities & Calls)
// Staff record the context of any conversation with the family – a call, WhatsApp chat, walk-in visit, e-mail or
// meeting: when, how, who they spoke with, what was discussed and the agreed next step (optionally with a follow-up
// date, which becomes a follow-up task). Entries are lead timeline events (type "conv"), kept with the lead's history.
(function () {
  var CH = ['Phone call', 'WhatsApp', 'Walk-in / visit', 'E-mail', 'Video meeting', 'Other'];
  var WITH = ['Parent', 'Student', 'Parent and student', 'Other family member', 'Other'];
  function nowLocal() {
    return new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 16);
  } // Gulf time, as locIso() reads it
  function convs(l) {
    return (l.events || [])
      .filter(function (e) {
        return e.type === 'conv' && e.conv;
      })
      .sort(function (a, b) {
        return new Date(b.conv.when || b.at) - new Date(a.conv.when || a.at);
      });
  }
  window.convCard = function (l) {
    var rows = convs(l);
    var list = rows.length
      ? rows
          .map(function (e) {
            var c = e.conv;
            return (
              '<div class="conv-it"><div class="conv-hd"><b>' +
              esc(c.ch) +
              '</b><span class="muted">with ' +
              esc(c.with) +
              '</span><span class="muted sm" style="margin-left:auto">' +
              fDT(c.when || e.at) +
              ' · ' +
              esc(e.by || '') +
              '</span></div>' +
              '<div class="conv-tx">' +
              esc(c.ctx) +
              '</div>' +
              (c.next
                ? '<div class="conv-nx"><span class="badge info">Next step</span> ' +
                  esc(c.next) +
                  (c.fu ? ' <span class="muted sm">· follow-up ' + fDT(c.fu) + '</span>' : '') +
                  '</div>'
                : '') +
              '</div>'
            );
          })
          .join('')
      : '<div class="empty"><b>No conversations logged yet</b><div class="muted">Use <b>Log conversation</b> to record what was discussed with the family.</div></div>';
    return (
      card('Conversation log', '<div class="conv-list">' + list + '</div>', {
        act:
          '<button class="btn sm primary" data-act="convNew" data-id="' +
          esc(l.id) +
          '">' +
          ic('plus') +
          ' Log conversation</button>',
      }) + '<div style="height:14px"></div>'
    );
  };
  ACT.convNew = function (d) {
    openModal('convLog', { id: d.id });
  };
  MODALS.convLog = function (m) {
    var l = leadById(m.id);
    return {
      title: 'Log conversation – ' + l.student,
      form: 'convLog',
      ok: 'Save conversation',
      body:
        '<input type="hidden" name="id" value="' +
        esc(l.id) +
        '"><div class="row" style="margin-bottom:12px"><span class="mono">' +
        esc(l.phone) +
        '</span><span class="muted sm">' +
        esc(l.parent) +
        '</span></div>' +
        '<div class="fgrid">' +
        F('How did you talk?', 'ch', { opts: CH, v: 'Phone call', req: 1 }) +
        F('Spoke with', 'with', { opts: WITH, v: 'Parent', req: 1 }) +
        F('When', 'when', { t: 'datetime-local', v: nowLocal(), req: 1 }) +
        F('Context of the conversation', 'ctx', {
          t: 'textarea',
          full: 1,
          req: 1,
          help: 'What was discussed – the family’s needs, questions, concerns, interest level and anything agreed.',
        }) +
        F('Next step (optional)', 'next', {
          full: 1,
          help: 'e.g. Send fee details on WhatsApp, book a trial class on Saturday.',
        }) +
        F('Follow-up date (optional)', 'fu', {
          t: 'datetime-local',
          help: 'Creates a follow-up call on the calendar.',
        }) +
        '</div>',
    };
  };
  SUB.convLog = function (d, f) {
    if (!need(f, d, ['ch', 'with', 'when', 'ctx'])) return;
    var ctx = String(d.ctx).trim(),
      next = String(d.next || '').trim();
    if (ctx.length < 5) {
      setErr(f, 'ctx', 'Please describe the conversation');
      return;
    }
    if (ctx.length > 4000) {
      setErr(f, 'ctx', 'Keep it under 4,000 characters');
      return;
    }
    var when = locIso(d.when);
    if (!when || isNaN(new Date(when)) || new Date(when) > new Date(Date.now() + 5 * 6e4)) {
      setErr(f, 'when', 'The conversation date cannot be in the future');
      return;
    }
    var fu = d.fu ? locIso(d.fu) : null;
    if (fu && new Date(fu) < new Date()) {
      setErr(f, 'fu', 'The follow-up must be in the future');
      return;
    }
    var l = leadById(d.id);
    l.events.push({
      at: nowIso(),
      type: 'conv',
      by: me().name,
      text: 'Conversation (' + d.ch + ', with ' + d['with'] + '): ' + ctx + (next ? ' · Next step: ' + next : ''),
      conv: { ch: d.ch, with: d['with'], when: when, ctx: ctx, next: next, fu: fu },
    });
    l.last = nowIso();
    if (fu) {
      S.tasks.push({
        id: 'T-' + S.seq.task++,
        lead: l.id,
        cslr: fuOwner(l),
        due: fu,
        type: 'Follow-up call',
        status: 'Pending',
        remarks: next ? 'From conversation: ' + next : 'From conversation log',
        outcome: '',
        next: '',
      });
      syncNext(l);
    }
    addAudit('Conversation logged', l.id, d.ch + ' with ' + d['with']);
    closeModal();
    toast('Conversation logged' + (fu ? ' – follow-up added to the calendar' : ''), 'ok');
  };
})();
