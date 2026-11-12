/* Workflow rules: lead routing, assignment, notifications, audit entries. */
/* ====== business logic ====== */
const normPh = (p) =>
  String(p || '')
    .replace(/\D/g, '')
    .slice(-9);
function findDup(phone, email) {
  const ph = normPh(phone),
    em = String(email || '')
      .trim()
      .toLowerCase(),
    out = [];
  S.leads.forEach((l) => {
    if ((ph && normPh(l.phone) === ph) || (em && l.email.toLowerCase() === em))
      out.push({
        kind: 'Lead',
        id: l.id,
        name: l.student + ' / ' + l.parent,
        sub: branchName(l.branch) + ' · ' + l.status,
        go: lgo(l.id),
      });
  });
  S.students.forEach((s) =>
    s.parents.forEach((p) => {
      if ((ph && normPh(p.mobile) === ph) || (em && p.email.toLowerCase() === em))
        if (!out.find((o) => o.id === s.id))
          out.push({
            kind: 'Student',
            id: s.id,
            name: s.first + ' ' + s.last + ' / ' + p.name,
            sub: 'Existing student · ' + branchName(s.branch),
            go: sgo(s.id),
          });
    }),
  );
  return out;
}
function msgFrom(t, l, x) {
  const c = l.cslr ? staffName(l.cslr) : 'our team';
  return t
    .replace(/\{parent_name\}/g, l.parent)
    .replace(/\{student_name\}/g, l.student)
    .replace(/\{programme\}/g, PNAME(l.prog))
    .replace(/\{branch\}/g, branchName(l.branch))
    .replace(/\{counsellor\}/g, c)
    .replace(/\{student_id\}/g, (x && x.sid) || '');
}
function createLead(d, by) {
  const R = S.cfg;
  const id = 'LD-26-' + S.seq.lead++;
  const l = {
    id,
    student: d.student,
    age: d.dob ? age(d.dob) : +d.age || 0,
    dob: d.dob || '',
    parent: d.parent,
    phone: d.phone,
    email: d.email,
    branch: d.branch,
    prog: d.prog,
    src: d.src,
    camp: d.camp || '—',
    cat: d.cat || 'Warm',
    stage: 'New Lead',
    cslr: null,
    enq: d.enq || nowIso(),
    fc: null,
    status: 'Open',
    noResp: 0,
    nextFU: null,
    last: nowIso(),
    school: d.school || '',
    grade: d.grade || '',
    curr: d.curr || '',
    wa: !!d.wa,
    em: !!d.em,
    notes: d.notes || '',
    origCat: null,
    closeReason: '',
    lostReason: '',
    events: [],
    assign: [],
    avail: null,
    custom: {},
  };
  l.events.push({
    at: l.enq,
    type: 'sys',
    text: 'Lead created from ' + l.src + (l.camp && l.camp !== '—' ? ' · ' + l.camp : ''),
    by: by || 'System',
  });
  let rt = null;
  if (d.cslr && d.cslr !== 'auto') {
    l.cslr = d.cslr;
    l.assign.push({ at: nowIso(), from: '', to: d.cslr, by: me().name, how: 'Manual', reason: 'Selected at creation' });
    l.events.push({ at: nowIso(), type: 'sys', text: 'Assigned manually to ' + staffName(d.cslr), by: me().name });
  } else {
    rt = routeLead(l.branch, l.prog, l.cat);
    if (rt.pick) {
      l.cslr = rt.pick.id;
      l.assign.push({
        at: nowIso(),
        from: '',
        to: rt.pick.id,
        by: 'Routing rules',
        how: 'Auto (' + R.routing.method + ')',
        reason: 'New lead',
      });
      l.events.push({
        at: nowIso(),
        type: 'sys',
        text: 'Auto-assigned to ' + rt.pick.name + ' (' + R.routing.method + ')',
        by: 'System',
      });
    } else {
      l.events.push({
        at: nowIso(),
        type: 'crit',
        text: 'No eligible counsellor – lead placed in Unassigned queue; ' + R.routing.notifyNone + ' notified',
        by: 'System',
      });
      notify(
        'none',
        'crit',
        'No counsellor available: ' +
          l.student +
          ' (' +
          branchName(l.branch) +
          ' · ' +
          PNAME(l.prog) +
          ') – lead in Unassigned queue',
        { page: 'leads', preset: 'unassigned' },
        ['Admissions Head', 'Centre Administrator', 'System Administrator'],
        l.branch,
      );
    }
  }
  S.leads.unshift(l);
  const tpl = (n) => R.comms.find((t) => t.id === n);
  [
    ['T1', 'wa'],
    ['T2', 'wa'],
    ['T3', 'em'],
  ].forEach((a) => {
    const t = tpl(a[0]);
    if (!t || !t.auto) return;
    const consent = l[a[1]];
    const blocked = R.consentReq[a[1]] && !consent;
    S.comms.push({
      id: 'CM' + S.seq.cm++,
      lead: id,
      ch: t.ch,
      tpl: t.n,
      text: blocked
        ? 'Not sent – no ' + (a[1] === 'wa' ? 'WhatsApp' : 'email') + ' consent recorded'
        : msgFrom(t.body, l),
      at: nowIso(),
      status: blocked
        ? 'Blocked – no consent'
        : 'Queued (simulated – ' + (t.ch === 'WhatsApp' ? 'WhatsApp' : 'email') + ' not connected)',
      by: 'System',
    });
    if (!blocked && a[0] === 'T2') l.avail = { s: 'Requested', slot: null };
    if (!blocked)
      l.events.push({ at: nowIso(), type: 'msg', text: t.ch + ' "' + t.n + '" queued (simulated)', by: 'System' });
  });
  if (l.cslr)
    S.tasks.push({
      id: 'T-' + S.seq.task++,
      lead: id,
      cslr: l.cslr,
      due: new Date(NOW.getTime() + R.sla.mins * 6e4).toISOString(),
      type: 'First call',
      status: 'Pending',
      remarks: 'First-call SLA task',
      outcome: '',
      next: '',
    });
  if (l.cslr)
    notify(
      'new',
      'info',
      'New lead created: ' + l.student + ' (' + l.src + ') – assigned to ' + staffName(l.cslr),
      { page: 'lead', id },
      ['Counsellor', 'Centre Administrator'],
      l.branch,
      l.cslr,
    );
  addAudit('Lead created', id, 'Source ' + l.src + '; assigned to ' + staffName(l.cslr));
  return { l, rt };
}
function cancelTasks(l, why) {
  S.tasks.forEach((t) => {
    if (t.lead === l.id && t.status === 'Pending') {
      t.status = 'Cancelled';
      t.remarks = (t.remarks ? t.remarks + ' · ' : '') + why;
    }
  });
}
function scheduleNext(l, cat, fromNow) {
  const c = S.cfg.cad[cat];
  if (!c) return null;
  const due = new Date(NOW.getTime() + (fromNow ? c.h * 36e5 : c.every * 864e5)).toISOString();
  S.tasks.push({
    id: 'T-' + S.seq.task++,
    lead: l.id,
    cslr: l.cslr,
    due,
    type: 'Follow-up call',
    status: 'Pending',
    remarks:
      'Auto-scheduled: ' +
      cat +
      ' cadence (' +
      (fromNow ? 'initial within ' + c.h + ' h' : 'every ' + c.every + ' d') +
      ')',
    outcome: '',
    next: '',
  });
  l.nextFU = due;
  return due;
}
function openTask(l) {
  return S.tasks
    .filter((t) => t.lead === l.id && t.status === 'Pending')
    .sort((a, b) => new Date(a.due) - new Date(b.due))[0];
}
function syncNext(l) {
  const t = openTask(l);
  l.nextFU = t ? t.due : null;
}
function changeCat(l, cat, reason) {
  const old = l.cat;
  if (old === cat) return;
  if (cat === 'Not Interested') {
    l.cat = cat;
    l.status = 'Closed';
    l.closeReason = reason;
    cancelTasks(l, 'Lead closed – Not Interested');
    l.nextFU = null;
  } else if (cat === 'No Response') {
    l.origCat = old === 'No Response' ? l.origCat : old;
    l.cat = cat;
    l.noResp = Math.max(1, l.noResp);
  } else {
    l.cat = cat;
    if (l.status === 'Closed' && old === 'Not Interested') {
      l.status = 'Open';
      l.closeReason = '';
    }
    l.noResp = 0;
    cancelTasks(l, 'Superseded by category change');
    if (cat !== 'Not Interested') scheduleNext(l, cat, true);
    syncNext(l);
  }
  addEv(l, 'warn', 'Category changed ' + old + ' → ' + cat + (reason ? ' – reason: ' + reason : ''));
  addAudit('Lead category changed', l.id, old + ' → ' + cat + (reason ? ' (' + reason + ')' : ''));
}
function logCall(l, d) {
  const id = 'CL-' + String(S.seq.call++).padStart(3, '0');
  const first = !l.fc && d.dir === 'Outgoing' && d.status === 'Completed';
  const at = nowIso();
  S.calls.unshift({
    id,
    lead: l.id,
    dir: d.dir,
    from: d.dir === 'Outgoing' ? 'LOF ' + branchName(l.branch) : l.phone,
    to: d.dir === 'Outgoing' ? l.phone : 'LOF ' + branchName(l.branch),
    at,
    dur: +d.dur || 0,
    status: d.status,
    outcome: d.outcome,
    notes: d.notes || '',
    rec: '',
    first,
    by: me().id,
    sim: true,
  });
  if (first || (!l.fc && d.status === 'Completed')) {
    l.fc = at;
  }
  addEv(l, 'call', d.dir + ' call – ' + d.status + ' · ' + d.outcome + (d.notes ? ' · ' + d.notes : ''));
  if (l.stage === 'New Lead' && d.status === 'Completed') l.stage = 'Contacted';
  const t = openTask(l);
  if (t && (t.type === 'First call' || d.status === 'Completed')) {
    t.status = 'Done';
    t.outcome = d.outcome;
  }
  let closed = false;
  if (d.outcome === 'No answer') {
    l.noResp++;
    if (l.cat !== 'No Response') {
      l.origCat = l.cat;
      l.cat = 'No Response';
    }
    const max = S.cfg.life.noRespMax;
    if (l.noResp >= max) {
      l.status = 'Closed';
      l.closeReason = 'No Response – ' + max + ' unanswered attempts';
      cancelTasks(l, 'Lead auto-closed');
      l.nextFU = null;
      closed = true;
      addEv(l, 'crit', 'Lead automatically closed after ' + max + ' unanswered attempts', 'System');
      notify(
        'fu',
        'warn',
        'Lead auto-closed (No Response ×' + max + '): ' + l.student,
        { page: 'lead', id: l.id },
        ['Counsellor', 'Centre Administrator'],
        l.branch,
        l.cslr,
      );
    } else {
      scheduleNext(l, l.origCat || 'Warm', false);
      syncNext(l);
      addEv(l, 'warn', 'Unanswered attempt ' + l.noResp + ' of ' + max + ' – retry scheduled', 'System');
    }
  } else if (d.status === 'Completed') {
    if (l.cat === 'No Response') {
      l.cat = l.origCat || 'Warm';
      l.noResp = 0;
      addEv(l, 'sys', 'Contact re-established – category restored to ' + l.cat, 'System');
    }
    if (d.next) {
      S.tasks.push({
        id: 'T-' + S.seq.task++,
        lead: l.id,
        cslr: l.cslr,
        due: locIso(d.next),
        type: 'Follow-up call',
        status: 'Pending',
        remarks: 'Set after call: ' + d.outcome,
        outcome: '',
        next: '',
      });
    } else if (!openTask(l) && l.status === 'Open' && S.cfg.cad[l.cat]) scheduleNext(l, l.cat, true);
    syncNext(l);
  }
  addAudit('Call logged', l.id, d.dir + ' · ' + d.outcome + ' (simulated telephony)');
  return { closed };
}
function convertLead(l, d) {
  const o = {
    id: 'OP-26-' + String(S.seq.opp++).padStart(4, '0'),
    lead: l.id,
    student: l.student,
    parent: l.parent,
    branch: l.branch,
    prog: l.prog,
    pkg: d.pkg,
    cslr: l.cslr,
    stage: 'Opportunity',
    exp: locIso(d.exp + 'T00:00') || dAt(7, 0),
    next: d.next || 'Send fee breakdown',
    discount: null,
    discReq: null,
    decision: null,
    lost: '',
    stu: null,
    hist: [{ at: nowIso(), by: me().name, text: 'Opportunity created from ' + l.id }],
  };
  S.opps.unshift(o);
  l.status = 'Converted';
  l.stage = 'Opportunity';
  addEv(l, 'sys', 'Converted to Opportunity ' + o.id + ' – no longer counted as an open lead');
  addAudit('Lead converted', l.id, 'Opportunity ' + o.id);
  return o;
}
function reassign(l, to, reason, how) {
  const from = l.cslr;
  l.cslr = to || null;
  l.assign.push({ at: nowIso(), from: from || '', to: to || '', by: me().name, how: how || 'Manual', reason });
  addEv(l, 'sys', 'Reassigned ' + staffName(from) + ' → ' + staffName(to) + ' (' + (how || 'Manual') + ') – ' + reason);
  S.tasks.forEach((t) => {
    if (t.lead === l.id && t.status === 'Pending') t.cslr = to;
  });
  S.opps.forEach((o) => {
    if (o.lead === l.id && !['Enrolled', 'Lost'].includes(o.stage)) o.cslr = to;
  });
  if (to)
    notify(
      'assign',
      'info',
      'Lead assigned: ' + l.student + ' (' + l.id + ') – now with ' + staffName(to),
      { page: 'lead', id: l.id },
      ['Counsellor', 'Centre Administrator'],
      l.branch,
      to,
    );
  addAudit('Lead reassigned', l.id, staffName(from) + ' → ' + staffName(to) + ' (' + reason + ')');
}
function canDecide(a) {
  if (a.status !== 'Pending') return { ok: false, why: 'Already decided' };
  const u = me();
  const res =
    a.type === 'Exceptional Discount'
      ? 'discount_requests'
      : a.type === 'Branch Transfer'
        ? 'branch_transfers'
        : 'reassignment';
  if (!can(res, 'A')) return { ok: false, why: u.role + ' cannot approve this request type' };
  if (a.approverRole !== u.role) return { ok: false, why: 'Configured approver: ' + a.approverRole };
  if (
    u.role === 'Admissions Head' &&
    !roleScope(u).includes(
      a.payload.from && ['KRM', 'SPC', 'AUH', 'BLR', 'HYD'].includes(a.payload.from) ? a.payload.from : a.branch,
    )
  )
    return { ok: false, why: 'Outside your branch scope' };
  if (a.by === u.id) return { ok: false, why: 'Requester cannot approve own request' };
  return { ok: true };
}
function decide(a, ok, remarks) {
  const u = me(),
    at = nowIso();
  a.status = ok ? 'Approved' : 'Rejected';
  a.decision = { by: u.id, at, remarks };
  a.hist.push({ at, by: u.id, action: a.status, remarks });
  if (a.type === 'Exceptional Discount') {
    const o = oppById(a.payload.opp);
    if (o) {
      o.discReq = null;
      if (ok) {
        o.discount = {
          kind: 'exceptional',
          ref: a.id,
          name: 'Exceptional discount',
          type: a.payload.type,
          value: a.payload.value,
        };
        o.next = 'Discount approved – proceed to enrolment';
      } else o.next = 'Discount rejected – inform parent';
      o.hist.push({
        at,
        by: u.name,
        text: 'Exceptional discount ' + a.id + ' ' + a.status.toLowerCase() + (remarks ? ' – ' + remarks : ''),
      });
    }
    notify(
      'disc',
      ok ? 'ok' : 'warn',
      'Discount ' + a.status.toLowerCase() + ': ' + a.summary,
      { page: 'approvalHistory' },
      ['Counsellor', 'Centre Administrator'],
      a.branch,
      a.by.startsWith('S') && (S.staff.find((s) => s.id === a.by) || {}).role === 'Counsellor' ? a.by : null,
    );
  } else if (a.type === 'Branch Transfer') {
    const l = leadById(a.payload.lead);
    if (l) {
      if (ok) {
        const from = l.branch;
        l.branch = a.payload.to;
        addEv(
          l,
          'sys',
          'Branch transfer approved: ' + branchName(from) + ' → ' + branchName(l.branch) + ' (by ' + u.name + ')',
        );
        const r = routeLead(l.branch, l.prog, l.cat);
        reassign(
          l,
          r.pick ? r.pick.id : null,
          r.pick ? 'Re-routed after branch transfer' : 'No eligible counsellor in new branch',
          'Auto (after transfer)',
        );
        if (!r.pick)
          notify(
            'none',
            'crit',
            'No counsellor available in ' + branchName(l.branch) + ' for transferred lead ' + l.student,
            { page: 'leads', preset: 'unassigned' },
            ['Admissions Head', 'Centre Administrator'],
            l.branch,
          );
        S.opps.forEach((o) => {
          if (o.lead === l.id) o.branch = l.branch;
        });
      } else addEv(l, 'warn', 'Branch transfer rejected by ' + u.name + (remarks ? ' – ' + remarks : ''));
    }
    notify(
      'transfer',
      ok ? 'ok' : 'warn',
      'Branch transfer ' + a.status.toLowerCase() + ': ' + a.summary,
      { page: 'approvalHistory' },
      ['Admissions Head', 'Counsellor', 'Centre Administrator'],
      a.payload.to,
    );
  } else {
    const l = leadById(a.payload.lead);
    if (l) {
      if (ok) reassign(l, a.payload.to, 'Approved request ' + a.id, 'Approved reassignment');
      else addEv(l, 'warn', 'Reassignment request rejected – ' + (remarks || ''));
    }
  }
  addAudit('Approval decision', a.id, a.status + ' – ' + a.summary + (remarks ? ' (' + remarks + ')' : ''));
}
function newApproval(type, payload, summary, reason, branch, refKind, ref) {
  const a = {
    id: 'AP-26-' + String(S.seq.ap++).padStart(4, '0'),
    type,
    by: me().id,
    at: nowIso(),
    status: 'Pending',
    refKind,
    ref,
    branch,
    summary,
    reason,
    payload,
    decision: null,
    approverRole: (
      S.cfg.wf.find((w) =>
        w.t.startsWith(
          type === 'Branch Transfer'
            ? 'Branch'
            : type === 'Exceptional Discount'
              ? 'Exceptional'
              : 'Counsellor reassignment (Counsellor',
        ),
      ) || { ap: 'Admissions Head' }
    ).ap,
    hist: [{ at: nowIso(), by: me().id, action: 'Requested', remarks: reason }],
  };
  S.approvals.unshift(a);
  addAudit('Approval requested', a.id, summary);
  return a;
}
function newStuId() {
  return 'LOF-26-' + String(S.seq.student++).padStart(6, '0');
}
