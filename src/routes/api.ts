import { Hono } from 'hono';
import { requireAuth, need, needScope, inList, can, type AppEnv } from '../lib/auth';
import { allow } from '../lib/ratelimit';
import { nowIso } from '../lib/db';
import { EXACT_SEQS, BLOCK_SEQS } from '../lib/indexing';
import { HttpError } from '../types';
import { bootstrap } from '../sync/bootstrap';
import { applySync } from '../sync/sync';
import { createLead, findDup, addAudit, addEv, money, r2, dayKey, notify, recalcEnrollment } from '../domain/core';
import { instStatus, refundCalc, daysBetween, lmsEnrolPayload, lmsMissing } from '../domain/terms';
import { createPaymentLink, createOppPaymentLink, canShareOppLink, processSync, payLinkUrl, linkExpired, markLinkSent } from '../domain/workflows';
import { dispatch } from '../jobs';
import { modeFor } from '../integrations/base';
import { clickToCall } from '../integrations/exotel';
import { receiptPage } from './receipt';
import { loadBillingDoc, invoicePdf, receiptPdf, docFileNames } from '../domain/billing-docs';
import { importLeads, IMPORT_MAX } from '../domain/lead-import';
import { sendToParent } from '../domain/workflows';

export const api = new Hono<AppEnv>();
api.use('*', requireAuth);

const wait = (c: any) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

// ------------------------------------------------------------------ state for the screens
api.get('/bootstrap', async (c) => c.json(await bootstrap(c.env, c.get('repo'), c.get('user'), c.get('perms'))));

api.put('/sync', async (c) => {
  const raw = await c.req.text();
  if (raw.length > 2_000_000) throw new HttpError(413, 'Too much data in one save');
  let body: { changes?: any[]; settings?: any[] };
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  if ((body.changes?.length || 0) > 500) throw new HttpError(413, 'Too many changes in one batch');
  const r = await applySync(c.env, c.get('repo'), c.get('user'), c.get('perms'), body.changes || [], body.settings || []);
  if (!r.ok) return c.json({ ok: false, error: r.rejected.map((x) => x.reason).join('; '), rejected: r.rejected }, 409);
  await dispatch(c.env, wait(c), r.jobs);
  return c.json({ ok: true, docs: r.docs, notices: r.notices, settings: r.settings, jobs: r.jobs.length });
});

api.post('/seq/claim', async (c) => {
  if (!(await allow(c.env, 'seq:' + c.get('user').id, 120, 60))) throw new HttpError(429, 'Too many requests');
  const { name, expect } = await c.req.json<{ name: string; expect: number }>();
  if (!EXACT_SEQS.includes(name)) throw new HttpError(400, 'Unknown sequence');
  return c.json(await c.get('repo').claim(name, +expect));
});
api.post('/seq/block', async (c) => {
  if (!(await allow(c.env, 'seqb:' + c.get('user').id, 60, 60))) throw new HttpError(429, 'Too many requests');
  const { name, size } = await c.req.json<{ name: string; size?: number }>();
  if (!BLOCK_SEQS.includes(name)) throw new HttpError(400, 'Unknown sequence');
  const n = Math.min(Math.max(+(size || 20), 1), 100);
  return c.json({ start: await c.get('repo').block(name, n), size: n });
});

// ------------------------------------------------------------------ helpers
const page = (c: any) => ({ limit: Math.min(Math.max(Math.floor(+(c.req.query('limit') || 50)) || 50, 1), 200), offset: Math.max(Math.floor(+(c.req.query('offset') || 0)) || 0, 0) });
async function list(c: any, type: string, where: string[], binds: unknown[], order = 'at DESC') {
  const { limit, offset } = page(c);
  const w = where.length ? ' AND ' + where.join(' AND ') : '';
  const total = await c.env.DB.prepare(`SELECT COUNT(*) n FROM docs WHERE type=?${w}`).bind(type, ...binds).first();
  const r = await c.env.DB.prepare(`SELECT data FROM docs WHERE type=?${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(type, ...binds, limit, offset).all();
  return { total: total?.n ?? 0, limit, offset, items: (r.results || []).map((x: any) => JSON.parse(x.data)) };
}
const scopeWhere = (c: any, col = 'branch') => { const sc = c.get('user').scope; return { sql: `${col} IN (${inList(sc)})`, binds: sc }; };

// ------------------------------------------------------------------ leads
api.get('/leads', async (c) => {
  need(c, 'leads', 'V');
  const s = scopeWhere(c);
  const where = [s.sql], binds: unknown[] = [...s.binds];
  const q = c.req.query();
  if (q.status) { where.push('status=?'); binds.push(q.status); }
  if (q.branch) {
    if (!['Management', 'System Administrator'].includes(c.get('user').role)) {
      if (!c.get('user').scope.includes(q.branch)) {
        throw new HttpError(403, 'Branch selection is restricted to System Administrators and Management');
      }
    }
    where.push('branch=?'); binds.push(q.branch);
  }
  if (q.counsellor) { where.push('owner=?'); binds.push(q.counsellor); }
  if (q.category) { where.push("json_extract(data,'$.cat')=?"); binds.push(q.category); }
  if (q.source) { where.push("json_extract(data,'$.src')=?"); binds.push(q.source); }
  if (q.from) { where.push('at>=?'); binds.push(q.from); }
  if (q.to) { where.push('at<=?'); binds.push(q.to + 'T23:59:59Z'); }
  if (q.q) { where.push('(id LIKE ? OR data LIKE ?)'); binds.push(`%${q.q}%`, `%${q.q}%`); }
  return c.json(await list(c, 'lead', where, binds));
});

api.get('/leads/:id', async (c) => {
  need(c, 'leads', 'V');
  const repo = c.get('repo');
  const l = await repo.get<any>('lead', c.req.param('id'));
  if (!l) throw new HttpError(404, 'Lead not found');
  needScope(c, l.branch);
  const [tasks, calls, comms, opps] = await Promise.all(['task', 'call', 'comm', 'opp'].map((t) => repo.many(t, 'ref1=?', [l.id], 'at')));
  return c.json({ lead: l, tasks, calls, comms, opportunities: opps });
});

/**
 * Remarks on a communication with a lead (a call, WhatsApp or e-mail, sent or received). They can be written or
 * changed until 24 hours after the communication; after that the record is closed for remarks.
 */
export const REMARK_HOURS = 24;
api.post('/leads/:id/remarks', async (c) => {
  const u = c.get('user');
  if (!(can(c.get('perms'), u, 'leads', 'E') || can(c.get('perms'), u, 'leads', 'C'))) throw new HttpError(403, `${u.role} cannot add communication remarks`);
  const repo = c.get('repo');
  const lead = await repo.get<any>('lead', c.req.param('id'));
  if (!lead) throw new HttpError(404, 'Lead not found');
  needScope(c, lead.branch);
  const body = await c.req.json<{ kind?: string; rec?: string; text?: string }>().catch(() => ({} as any));
  const type = body.kind === 'call' ? 'call' : body.kind === 'comm' ? 'comm' : '';
  if (!type) throw new HttpError(400, 'kind must be call or comm');
  const rec = await repo.get<any>(type, String(body.rec || ''));
  if (!rec || rec.lead !== lead.id) throw new HttpError(404, 'Communication not found on this lead');
  if (!(Date.now() - Date.parse(rec.at) <= REMARK_HOURS * 36e5)) throw new HttpError(409, `Remarks can only be added within ${REMARK_HOURS} hours of the communication – this one was on ${new Date(rec.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  const text = String(body.text ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length < 3) throw new HttpError(400, 'Write the remarks (at least 3 characters)');
  if (text.length > 1000) throw new HttpError(400, 'Remarks can be at most 1000 characters');
  const prev = rec.remark?.text;
  rec.remark = { text, by: u.name, byId: u.id, at: nowIso(), ...(prev ? { edited: true } : {}) };
  await repo.put(type, rec);
  const what = type === 'call' ? `${rec.dir || ''} call`.trim() : `${rec.inbound ? 'Received ' : ''}${rec.ch}`;
  addEv(lead, 'note', `Remarks on ${what} (${new Date(rec.at).toISOString().slice(0, 16).replace('T', ' ')} UTC): ${text.slice(0, 200)}`, u.name);
  await repo.put('lead', lead);
  await addAudit(repo, prev ? 'Communication remarks changed' : 'Communication remarks added', rec.id, prev ? `"${prev.slice(0, 300)}" → "${text.slice(0, 300)}"` : text.slice(0, 500));
  return c.json({ ok: true, kind: type, rec, lead });
});

/** Bulk lead import from an Excel / CSV sheet: dryRun checks every row, then the same rows are created. */
api.post('/leads/import', async (c) => {
  need(c, 'leads', 'C');
  const raw = await c.req.text();
  if (raw.length > 3_000_000) throw new HttpError(413, 'The file is too large');
  let body: any;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || !rows.length) throw new HttpError(400, 'The sheet has no rows to import');
  if (rows.length > IMPORT_MAX) throw new HttpError(413, `At most ${IMPORT_MAX} leads per file – split the sheet`);
  const r = await importLeads(c.get('repo'), c.get('user'), rows, {
    defaults: body.defaults && typeof body.defaults === 'object' ? body.defaults : {},
    sendMessages: body.sendMessages === true, allowDuplicates: body.allowDuplicates === true, dryRun: body.dryRun !== false,
  });
  if (r.queuedComms.length) await dispatch(c.env, wait(c), r.queuedComms.map((id) => ({ kind: 'send_comm' as const, id })));
  return c.json({ results: r.results, summary: r.summary });
});

api.post('/leads', async (c) => {
  need(c, 'leads', 'C');
  const body = await c.req.json<any>();
  for (const k of ['student', 'parent', 'phone', 'branch', 'prog', 'src']) if (!String(body[k] ?? '').trim()) throw new HttpError(400, `${k} is required`);
  if (!/^\+?[\d\s()-]{7,20}$/.test(body.phone)) throw new HttpError(400, 'Enter a valid mobile number');
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) throw new HttpError(400, 'Enter a valid e-mail address');
  needScope(c, body.branch);
  const repo = c.get('repo');
  // Only documented fields reach the record; free text is length-capped
  const str = (v: unknown, n = 200) => (v == null ? undefined : String(v).slice(0, n));
  const cat = ['Hot', 'Warm', 'Cold'].includes(body.cat) ? body.cat : undefined;
  let cslr: string | undefined;
  if (body.cslr) {
    const st = await repo.get<any>('staff', String(body.cslr));
    if (!st || st.role !== 'Counsellor' || st.status !== 'Active' || st.access === 'Disabled' || st.branch !== body.branch) throw new HttpError(422, 'Selected counsellor cannot take leads for this branch');
    cslr = st.id;
  }
  const input: any = {
    student: str(body.student, 120), parent: str(body.parent, 120), phone: str(body.phone, 20), email: str(body.email, 160), branch: String(body.branch), prog: String(body.prog), src: str(body.src, 60),
    camp: str(body.camp, 120), cat, age: Number.isFinite(+body.age) ? Math.max(0, Math.min(25, Math.floor(+body.age))) : 0, dob: /^\d{4}-\d{2}-\d{2}$/.test(body.dob || '') ? body.dob : '',
    school: str(body.school, 160), grade: str(body.grade, 40), curr: str(body.curr, 60), notes: str(body.notes, 2000), cslr, wa: body.wa !== false, em: body.em !== false,
  };
  const dups = await findDup(repo, input.phone, input.email);
  if (dups.length && !body.allowDuplicate) {
    const sc = c.get('user').scope;
    return c.json({ error: 'Possible duplicate', duplicates: dups.map((d: any) => (sc.includes(d.branch) ? d : { kind: d.kind, id: d.id, branch: d.branch, name: 'Record in another branch' })) }, 409);
  }
  try {
    const r = await createLead(repo, input, c.get('user').name);
    await dispatch(c.env, wait(c), r.queuedComms.map((id) => ({ kind: 'send_comm' as const, id })));
    return c.json({ lead: r.lead, assignedTo: r.route?.pick?.id ?? r.lead.cslr, duplicates: r.duplicates }, 201);
  } catch (e: any) {
    throw new HttpError(422, e.message);
  }
});

api.post('/leads/duplicates', async (c) => {
  need(c, 'leads', 'V');
  const { phone, email } = await c.req.json<any>();
  const sc = c.get('user').scope;
  const dups = (await findDup(c.get('repo'), phone, email)).map((d: any) => (sc.includes(d.branch) ? d : { kind: d.kind, id: d.id, branch: d.branch, name: 'Record in another branch' }));
  return c.json({ duplicates: dups });
});

/** Exotel click-to-call: rings the counsellor's mobile, then bridges to the parent. */
api.post('/leads/:id/click-to-call', async (c) => {
  need(c, 'leads', 'E');
  const repo = c.get('repo');
  const l = await repo.get<any>('lead', c.req.param('id'));
  if (!l) throw new HttpError(404, 'Lead not found');
  needScope(c, l.branch);
  const me = await repo.get<any>('staff', c.get('user').id);
  if (!me?.mobile) throw new HttpError(400, 'Add your mobile number to your staff profile first');
  const cfg = await repo.setting<any>('cfg');
  const mode = modeFor(c.env, cfg, 'exotel');
  const cb = `${c.env.APP_BASE_URL.replace(/\/+$/, '')}/webhooks/exotel/status?token=${encodeURIComponent(c.env.EXOTEL_WEBHOOK_TOKEN || '')}&lead=${l.id}&staff=${me.id}`;
  try {
    const r = await clickToCall({ env: c.env, mode }, me.mobile, l.phone, cb, l.id);
    addEv(l, 'call', `Click-to-call started via Exotel${mode === 'mock' ? ' (mock)' : ''} – ringing ${me.name} first`, me.name);
    (l.pendingCalls ||= []).push({ sid: r.sid, at: nowIso(), by: me.id });
    await repo.put('lead', l);
    return c.json({ ok: true, mode, callSid: r.sid });
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});

/** Incoming-call screen-pop polling (Exotel passthru writes call_events). */
api.get('/calls/incoming', async (c) => {
  const u = c.get('user');
  const since = c.req.query('since') || new Date(Date.now() - 60_000).toISOString();
  const r = await c.env.DB.prepare(`SELECT * FROM call_events WHERE at>? AND (staff_id=? OR (staff_id IS NULL AND branch IN (${inList(u.scope)}))) ORDER BY at DESC LIMIT 5`)
    .bind(since, u.id, ...u.scope).all();
  return c.json({ events: r.results || [], now: nowIso() });
});

// ------------------------------------------------------------------ opportunities, approvals, tasks
api.get('/opportunities', async (c) => {
  need(c, 'opportunities', 'V');
  const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('stage')) { where.push('status=?'); binds.push(c.req.query('stage')); }
  return c.json(await list(c, 'opp', where, binds, 'created_at DESC'));
});
api.get('/approvals', async (c) => {
  const u = c.get('user'), perms = c.get('perms');
  if (!['discount_requests', 'branch_transfers', 'reassignment'].some((r) => can(perms, u, r, 'V'))) throw new HttpError(403, `${u.role} cannot view approvals`);
  const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('status')) { where.push('status=?'); binds.push(c.req.query('status')); }
  if (c.req.query('type')) { where.push("json_extract(data,'$.type')=?"); binds.push(c.req.query('type')); }
  return c.json(await list(c, 'approval', where, binds));
});
api.get('/tasks', async (c) => {
  need(c, 'leads', 'V');
  const u = c.get('user'); const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (u.role === 'Counsellor') { where.push('owner=?'); binds.push(u.id); }
  if (c.req.query('status')) { where.push('status=?'); binds.push(c.req.query('status')); }
  if (c.req.query('overdue') === '1') { where.push("status='Pending' AND at<?"); binds.push(nowIso()); }
  return c.json(await list(c, 'task', where, binds, 'at ASC'));
});

// ------------------------------------------------------------------ students, enrolments, payments
api.get('/students', async (c) => {
  need(c, 'students', 'V');
  const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('q')) { where.push('(id LIKE ? OR data LIKE ?)'); binds.push(`%${c.req.query('q')}%`, `%${c.req.query('q')}%`); }
  return c.json(await list(c, 'student', where, binds, 'id ASC'));
});
api.get('/students/:id', async (c) => {
  need(c, 'students', 'V');
  const repo = c.get('repo');
  const s = await repo.get<any>('student', c.req.param('id'));
  if (!s) throw new HttpError(404, 'Student not found');
  const enrollments = await repo.many<any>('enrollment', 'ref1=?', [s.id], 'at');
  if (!c.get('user').scope.includes(s.branch) && !enrollments.some((e) => c.get('user').scope.includes(e.branch))) throw new HttpError(403, 'Outside your branch access');
  const u = c.get('user'), perms = c.get('perms');
  const canEnr = can(perms, u, 'enrollments', 'V');
  const payments = can(perms, u, 'payments', 'V') ? (await repo.many<any>('payment', 'ref2=?', [s.id], 'at')).filter((p) => u.scope.includes(p.branch)) : [];
  const syncs = canEnr ? await repo.many('moodle_sync', 'ref2=?', [s.id], 'at') : [];
  return c.json({ student: s, enrollments: canEnr ? enrollments.filter((e) => u.scope.includes(e.branch)) : [], payments, moodle: syncs });
});
api.get('/enrollments', async (c) => {
  need(c, 'enrollments', 'V');
  const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('status')) { where.push('status=?'); binds.push(c.req.query('status')); }
  return c.json(await list(c, 'enrollment', where, binds));
});
api.get('/payments', async (c) => {
  need(c, 'payments', 'V');
  const s = scopeWhere(c); const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('from')) { where.push('at>=?'); binds.push(c.req.query('from')); }
  if (c.req.query('to')) { where.push('at<=?'); binds.push(c.req.query('to') + 'T23:59:59Z'); }
  return c.json(await list(c, 'payment', where, binds));
});
api.get('/payments/:id/receipt', async (c) => {
  need(c, 'payments', 'V');
  const repo = c.get('repo');
  const p = await repo.get<any>('payment', c.req.param('id'));
  if (!p) throw new HttpError(404, 'Payment not found');
  needScope(c, p.branch);
  const d = await loadBillingDoc(repo, p.id);
  if (!d) throw new HttpError(404, 'Payment not found');
  await addAudit(repo, 'Receipt generated', p.id, p.rc);
  c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  c.header('cache-control', 'no-store');
  return c.html(receiptPage(d));
});
/**
 * Cancel a transaction (wrong course, miscommunication …). Payments are never deleted: the payment keeps its receipt
 * and invoice numbers, is marked Cancelled with who/when/parent's knowledge/reason, and drops out of every total.
 * A cancellation is final. Refunds of the money are handled separately.
 */
api.post('/payments/:id/cancel', async (c) => {
  const u = c.get('user');
  if (!(can(c.get('perms'), u, 'payments', 'C') || can(c.get('perms'), u, 'payments', 'E'))) throw new HttpError(403, `${u.role} cannot cancel payments`);
  const repo = c.get('repo');
  const p = await repo.get<any>('payment', c.req.param('id'));
  if (!p) throw new HttpError(404, 'Payment not found');
  needScope(c, p.branch);
  if (p.status === 'Cancelled') throw new HttpError(409, 'This transaction is already cancelled');
  const body = await c.req.json<{ parentAware?: string; reason?: string; confirm?: boolean }>().catch(() => ({} as any));
  const parentAware = body.parentAware === 'Yes' || body.parentAware === 'No' ? body.parentAware : '';
  const reason = String(body.reason ?? '').replace(/\s+/g, ' ').trim();
  if (!parentAware) throw new HttpError(400, 'Answer whether the transaction is being cancelled with the parent\'s knowledge');
  if (reason.length < 10) throw new HttpError(400, 'Describe the reason for the cancellation (at least 10 characters)');
  if (reason.length > 500) throw new HttpError(400, 'The reason can be at most 500 characters');
  if (body.confirm !== true) throw new HttpError(400, 'Confirm that the cancellation cannot be undone');
  const refunds = (await repo.many<any>('refund', 'ref1=?', [p.enr])).filter((r) => r.status !== 'Rejected');
  if (refunds.length) throw new HttpError(409, `The enrolment has a refund (${refunds.map((r) => r.id).join(', ')}) – settle the refund before cancelling a payment`);
  p.status = 'Cancelled';
  p.cancel = { at: nowIso(), by: u.name, byId: u.id, parentAware, reason };
  await repo.put('payment', p);
  const e = await recalcEnrollment(repo, p.enr);
  const s = await repo.get<any>('student', p.stu);
  const who = s ? `${s.first} ${s.last}` : p.stu;
  await addAudit(repo, 'Payment cancelled', p.id, `${p.rc} · ${money(p.amt, p.cur)} · ${who} · with parent's knowledge: ${parentAware} · ${reason}${p.erp?.name ? ' · cancel ERPNext entry ' + p.erp.name : ''}`);
  await notify(repo, { type: 'pay', sev: 'warn', text: `Transaction cancelled: ${p.rc}, ${money(p.amt, p.cur)} – ${who}, by ${u.name}${parentAware === 'No' ? ' (parent not informed)' : ''}. Reason: ${reason}`.slice(0, 300), route: { page: 'payRecords' }, roles: ['Centre Administrator', 'Management', 'Reception'], branch: p.branch });
  return c.json({ ok: true, payment: p, enrollment: e });
});

/** Invoice or receipt PDF for a payment (the same files the parent receives by e-mail). */
api.get('/payments/:id/:file{(?:invoice|receipt)\\.pdf}', async (c) => {
  need(c, 'payments', 'V');
  const repo = c.get('repo');
  const p = await repo.get<any>('payment', c.req.param('id'));
  if (!p) throw new HttpError(404, 'Payment not found');
  needScope(c, p.branch);
  const d = await loadBillingDoc(repo, p.id);
  if (!d) throw new HttpError(404, 'Payment not found');
  const kind: 'invoice' | 'receipt' = c.req.param('file').startsWith('invoice') ? 'invoice' : 'receipt';
  const bytes = kind === 'invoice' ? await invoicePdf(d) : await receiptPdf(d);
  await addAudit(repo, kind === 'invoice' ? 'Invoice PDF downloaded' : 'Receipt PDF downloaded', p.id, kind === 'invoice' ? d.invoiceNo : d.receiptNo);
  return new Response(bytes, { headers: {
    'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename="${docFileNames(d)[kind]}"`,
  } });
});

api.post('/payments/links', async (c) => {
  need(c, 'payments', 'C');
  const { enrollmentId, amount } = await c.req.json<{ enrollmentId: string; amount?: number }>();
  const repo = c.get('repo');
  const e = await repo.get<any>('enrollment', enrollmentId);
  if (!e) throw new HttpError(404, 'Enrollment not found');
  needScope(c, e.branch);
  try {
    return c.json(await createPaymentLink(c.env, repo, enrollmentId, amount, c.get('user').name, { createdById: c.get('user').id }), 201);
  } catch (err: any) {
    throw new HttpError(422, err.message);
  }
});
api.get('/payments/links', async (c) => {
  need(c, 'payments', 'V');
  const enr = c.req.query('enrollmentId');
  const sc = c.get('user').scope;
  const r = await c.env.DB.prepare(`SELECT l.* FROM payment_links l JOIN docs e ON e.type='enrollment' AND e.id=l.enrollment_id WHERE e.branch IN (${inList(sc)}) ${enr ? 'AND l.enrollment_id=?' : ''} ORDER BY l.created_at DESC LIMIT 100`).bind(...sc, ...(enr ? [enr] : [])).all<any>();
  return c.json({ items: (r.results || []).map((l) => ({ ...l, draft: undefined, status: linkExpired(l) ? 'expired' : l.status, url: payLinkUrl(c.env, l.id) })) });
});

/** Payment link shared from an opportunity (Opportunity or Admission Decision stage). The body carries the filled-in
 *  enrolment form as sync changes; it is checked now and applied – the student is enrolled – when the parent pays. */
api.post('/opps/:id/payment-link', async (c) => {
  const u = c.get('user');
  if (!canShareOppLink(c.get('perms'), u)) throw new HttpError(403, `${u.role} cannot share payment links`);
  const repo = c.get('repo');
  const opp = await repo.get<any>('opp', c.req.param('id'));
  if (!opp) throw new HttpError(404, 'Opportunity not found');
  needScope(c, opp.branch);
  const raw = await c.req.text();
  if (raw.length > 400_000) throw new HttpError(413, 'Too much data');
  let body: { changes?: any[]; amount?: number };
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  const amount = body.amount === undefined || body.amount === null ? undefined : Number(body.amount);
  try {
    return c.json(await createOppPaymentLink(c.env, repo, u, c.get('perms'), opp.id, body.changes as any, amount), 201);
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, err.message);
  }
});
api.get('/opps/:id/payment-links', async (c) => {
  need(c, 'opportunities', 'V');
  const repo = c.get('repo');
  const opp = await repo.get<any>('opp', c.req.param('id'));
  if (!opp) throw new HttpError(404, 'Opportunity not found');
  needScope(c, opp.branch);
  const r = await c.env.DB.prepare('SELECT id,provider,enrollment_id,amount,currency,status,payment_id,created_by,created_at,paid_at,apply_error,expires_at,kind FROM payment_links WHERE opp_id=? ORDER BY created_at DESC LIMIT 20').bind(opp.id).all<any>();
  return c.json({ items: (r.results || []).map((l) => ({ ...l, status: linkExpired(l) ? 'expired' : l.status, url: payLinkUrl(c.env, l.id) })) });
});

/** Send a payment link to the parent over WhatsApp or e-mail (respects consent). */
api.post('/payments/links/:id/send', async (c) => {
  const { channel } = await c.req.json<{ channel: 'WhatsApp' | 'Email' }>();
  const link = await c.env.DB.prepare('SELECT * FROM payment_links WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!link) throw new HttpError(404, 'Link not found');
  const repo = c.get('repo');
  if (linkExpired(link)) throw new HttpError(409, 'This link has expired – create a new one');
  if (link.status !== 'created') throw new HttpError(409, `This link is ${link.status}`);
  const linkUrl = payLinkUrl(c.env, link.id);
  if (!['WhatsApp', 'Email'].includes(channel)) throw new HttpError(400, 'Choose WhatsApp or Email');
  const e = await repo.get<any>('enrollment', link.enrollment_id);
  if (!e && link.opp_id) {
    // Shared from an opportunity: the student is not enrolled yet – the message goes to the lead's parent
    if (!canShareOppLink(c.get('perms'), c.get('user'))) throw new HttpError(403, `${c.get('user').role} cannot share payment links`);
    const opp = await repo.get<any>('opp', link.opp_id);
    if (!opp) throw new HttpError(404, 'Opportunity not found');
    needScope(c, opp.branch);
    const lead = await repo.get<any>('lead', opp.lead);
    if (!lead) throw new HttpError(404, 'Lead not found');
    const progs = await repo.many<any>('program');
    const prog = (progs.find((p) => p.id === opp.prog) || { name: opp.prog }).name;
    const text = `Dear ${lead.parent || 'Parent'}, please use this secure link to pay ${money(link.amount, link.currency)} for ${opp.student}'s enrolment in ${prog} at Lab of Future: ${linkUrl} – the seat is confirmed as soon as the payment is received. The link is valid for 24 hours.`;
    const id = await repo.newId('cm');
    await repo.put('comm', { id, lead: lead.id, ch: channel, tpl: 'Payment link', text, at: nowIso(), status: 'Queued', by: c.get('user').name });
    await dispatch(c.env, wait(c), [{ kind: 'send_comm', id }]);
    await markLinkSent(c.env, link.id, { by: c.get('user').name, byId: c.get('user').id, via: channel, to: channel === 'WhatsApp' ? lead.phone : lead.email });
    return c.json({ ok: true, commId: id });
  }
  need(c, 'payments', 'C');
  if (!e) throw new HttpError(404, 'Enrollment not found');
  needScope(c, e.branch);
  const s = await repo.get<any>('student', e.stu);
  const opp = e.opp ? await repo.get<any>('opp', e.opp) : null;
  const lead = opp ? await repo.get<any>('lead', opp.lead) : null;
  const parent = (s?.parents || [])[0] || {};
  const text = `Dear ${lead?.parent || parent.name || 'Parent'}, please use this secure link to pay ${money(link.amount, link.currency)} for ${s.first}'s enrolment at Lab of Future: ${linkUrl}${link.expires_at ? ' – the link is valid for 24 hours.' : ''}`;
  if (lead) {
    const id = await repo.newId('cm');
    await repo.put('comm', { id, lead: lead.id, ch: channel, tpl: 'Payment link', text, at: nowIso(), status: 'Queued', by: c.get('user').name });
    await dispatch(c.env, wait(c), [{ kind: 'send_comm', id }]);
    await markLinkSent(c.env, link.id, { by: c.get('user').name, byId: c.get('user').id, via: channel, to: channel === 'WhatsApp' ? lead.phone : lead.email });
    return c.json({ ok: true, commId: id });
  }
  // Walk-in / existing students: send to the parent on the student record (transactional message about their own enrolment)
  const r = await sendToParent(c.env, repo, s, channel, text);
  if (r.ok) await markLinkSent(c.env, link.id, { by: c.get('user').name, byId: c.get('user').id, via: channel, to: channel === 'WhatsApp' ? parent.mobile : parent.email });
  return c.json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
});

/**
 * Payments → Payment links: every link with who it went to, who created and sent it, and whether the parent paid.
 * Counsellors (and anyone without payment access) see only the links they created or sent.
 */
api.get('/payments/link-list', async (c) => {
  const u = c.get('user'), perms = c.get('perms');
  const canPay = can(perms, u, 'payments', 'V');
  if (!canPay && !canShareOppLink(perms, u)) throw new HttpError(403, `${u.role} cannot view payment links`);
  const own = u.role === 'Counsellor' || !canPay;
  const repo = c.get('repo');
  const rows = (await c.env.DB.prepare(`SELECT * FROM payment_links WHERE is_test=? ${own ? 'AND (created_by_id=? OR sent_by_id=? OR (created_by_id IS NULL AND created_by=?))' : ''} ORDER BY created_at DESC LIMIT 500`)
    .bind(repo.isTest ? 1 : 0, ...(own ? [u.id, u.id, u.name] : [])).all<any>()).results || [];
  const cache = new Map<string, any>();
  const get = async (type: string, id: unknown) => {
    if (!id) return null;
    const k = type + ':' + id;
    if (!cache.has(k)) cache.set(k, await repo.get<any>(type, String(id)));
    return cache.get(k);
  };
  const progs = await repo.many<any>('program');
  const pname = (id: string) => (progs.find((p) => p.id === id) || { name: id || '' }).name;
  const now = nowIso();
  const items: any[] = [];
  for (const l of rows) {
    const e = await get('enrollment', l.enrollment_id);
    const opp = l.opp_id ? await get('opp', l.opp_id) : e?.opp ? await get('opp', e.opp) : null;
    const s = e ? await get('student', e.stu) : null;
    const lead = opp ? await get('lead', opp.lead) : null;
    const branch = e?.branch || opp?.branch;
    if (!branch || !u.scope.includes(branch)) continue;
    const parent = (s?.parents || [])[0] || {};
    const pay = l.payment_id ? await get('payment', l.payment_id) : null;
    items.push({
      id: l.id, url: payLinkUrl(c.env, l.id), kind: l.kind || (l.opp_id ? 'opp' : 'collect'), amount: l.amount, currency: l.currency,
      status: linkExpired(l, now) ? 'expired' : l.status, applyError: l.apply_error || null,
      student: s ? `${s.first} ${s.last}` : opp?.student || '', studentId: s?.id || null,
      parent: lead?.parent || parent.name || opp?.parent || '', phone: lead?.phone || parent.mobile || '', email: lead?.email || parent.email || '',
      branch, prog: pname(e?.prog || opp?.prog), enrollment: e?.id || null, opp: opp?.id || null, lead: lead?.id || null,
      createdBy: l.created_by, createdAt: l.created_at, expiresAt: l.expires_at,
      sentBy: l.sent_by, sentVia: l.sent_via, sentTo: l.sent_to, sentAt: l.sent_at, sends: l.sends || 0,
      paidAt: l.paid_at, receipt: pay?.rc || null, paymentStatus: pay?.status || null,
    });
  }
  return c.json({ items, own });
});

// ------------------------------------------------------------------ LMS calls (enrol / cancel); /moodle/syncs kept as an alias
const syncList = async (c: any) => {
  need(c, 'enrollments', 'V');
  const s = scopeWhere(c);
  const where = [s.sql]; const binds: unknown[] = [...s.binds];
  if (c.req.query('status')) { where.push('status=?'); binds.push(c.req.query('status')); }
  if (c.req.query('op')) { where.push("json_extract(data,'$.op')=?"); binds.push(c.req.query('op')); }
  return c.json(await list(c, 'moodle_sync', where, binds));
};
const syncGet = async (c: any) => {
  need(c, 'enrollments', 'V');
  const m = await c.get('repo').get('moodle_sync', c.req.param('id'));
  if (!m) throw new HttpError(404, 'LMS call not found');
  needScope(c, (await c.get('repo').getRow('moodle_sync', m.id))?.branch);
  return c.json(m);
};
const syncRetry = async (c: any) => {
  const u = c.get('user');
  if (!['System Administrator', 'Admissions Head', 'Centre Administrator', 'Management'].includes(u.role)) throw new HttpError(403, `${u.role} cannot retry LMS calls`);
  const repo = c.get('repo');
  const m = await repo.get('moodle_sync', c.req.param('id'));
  if (!m) throw new HttpError(404, 'LMS call not found');
  needScope(c, (await repo.getRow('moodle_sync', m.id))?.branch);
  if (m.status === 'Processing') throw new HttpError(409, 'The call is already running');
  if (m.status === 'Success') throw new HttpError(409, 'The call already succeeded');
  m.status = 'Pending';
  m.hist.push({ at: nowIso(), s: 'Pending', msg: `Manual retry by ${u.name}` });
  await repo.put('moodle_sync', m);
  return c.json(await processSync(c.env, repo, m.id));
};
for (const base of ['/lms/calls', '/moodle/syncs']) {
  api.get(base, syncList);
  api.get(base + '/:id', syncGet);
  api.post(base + '/:id/retry', syncRetry);
}

/** What the enrol call would send for an enrolment, and which required fields are still missing. */
api.get('/lms/preview/:enrollmentId', async (c) => {
  need(c, 'enrollments', 'V');
  const repo = c.get('repo');
  const e = await repo.get<any>('enrollment', c.req.param('enrollmentId'));
  if (!e) throw new HttpError(404, 'Enrolment not found');
  needScope(c, e.branch);
  const [s, program, cfg] = await Promise.all([repo.get<any>('student', e.stu), repo.get<any>('program', e.prog), repo.setting<any>('cfg')]);
  const payload = lmsEnrolPayload(e, s, program, cfg.lms || {});
  return c.json({ enrol: { call: 'enrol', ...payload }, cancel: { call: 'cancel', reference: e.id }, missing: lmsMissing(payload), mode: modeFor(c.env, cfg, 'lms') });
});

// ------------------------------------------------------------------ instalments, refunds, targets
api.get('/enrollments/:id/instalments', async (c) => {
  need(c, 'payments', 'V');
  const repo = c.get('repo');
  const e = await repo.get<any>('enrollment', c.req.param('id'));
  if (!e) throw new HttpError(404, 'Enrolment not found');
  needScope(c, e.branch);
  const cfg = await repo.setting<any>('cfg');
  const term = (cfg.payTerms || []).find((t: any) => t.id === e.term) || null;
  return c.json({ enrollment: e.id, term: term ? { id: term.id, name: term.name, grace: term.grace } : null, currency: e.cur, total: e.total, paid: e.paid, instalments: instStatus(e, term, dayKey(new Date())) });
});
api.get('/refunds/suggest', async (c) => {
  const u = c.get('user'), perms = c.get('perms');
  if (!(can(perms, u, 'enrollments', 'E') || can(perms, u, 'payments', 'C'))) throw new HttpError(403, `${u.role} cannot request refunds`);
  const repo = c.get('repo');
  const e = await repo.get<any>('enrollment', c.req.query('enrollmentId') || '');
  if (!e) throw new HttpError(404, 'Enrolment not found');
  needScope(c, e.branch);
  const sessions = Math.floor(+(c.req.query('sessions') || 0));
  if (!(sessions >= 0)) throw new HttpError(400, 'sessions must be 0 or more');
  const cfg = await repo.setting<any>('cfg');
  const days = daysBetween(e.date, dayKey(new Date()));
  const r = refundCalc(e, days, sessions, cfg.refund || { rules: [] });
  return c.json({ enrollment: e.id, currency: e.cur, days, sessions, ...r, approver: cfg.refund?.approver, confirmed: !!cfg.refund?.confirmed });
});
api.get('/targets', async (c) => {
  const u = c.get('user'), perms = c.get('perms');
  const month = c.req.query('month') || dayKey(new Date()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const repo = c.get('repo');
  const cfg = await repo.setting<any>('cfg');
  const staff = (await repo.many<any>('staff')).filter((s) => s.role === 'Counsellor' && u.scope.includes(s.branch) && (u.role !== 'Counsellor' || s.id === u.id));
  if (u.role !== 'Counsellor' && !can(perms, u, 'reports', 'V')) throw new HttpError(403, `${u.role} cannot view targets`);
  const enr = (await repo.many<any>('enrollment', `branch IN (${inList(u.scope)})`, u.scope)).filter((e) => e.date?.startsWith(month) && e.status !== 'Withdrawn');
  const leads = await repo.many<any>('lead', `branch IN (${inList(u.scope)})`, u.scope);
  const rows = staff.map((s) => {
    const t = (cfg.targets || []).find((x: any) => x.m === month && x.c === s.id) || null;
    const mine = enr.filter((e) => e.cslr === s.id);
    const ls = leads.filter((l) => l.cslr === s.id && dayKey(new Date(l.enq)).startsWith(month));
    return { counsellor: s.id, name: s.name, branch: s.branch, target: t && { enrolments: t.enr, revenue: t.rev, conversion: t.conv },
      achieved: { enrolments: mine.length, revenue: r2(mine.reduce((a, e) => a + e.total - e.tax, 0)), leads: ls.length, conversion: ls.length ? Math.round((mine.length / ls.length) * 100) : 0 } };
  });
  return c.json({ month, items: rows });
});

// ------------------------------------------------------------------ notifications & audit
api.get('/notifications', async (c) => {
  const u = c.get('user');
  const r = await c.env.DB.prepare(`SELECT data FROM docs WHERE type='notification' AND (branch IS NULL OR branch IN (${inList(u.scope)})) ORDER BY at DESC LIMIT 100`).bind(...u.scope).all<any>();
  const items = (r.results || []).map((x: any) => JSON.parse(x.data)).filter((n: any) => (!n.roles || n.roles.includes(u.role)) && (!n.cslr || u.role !== 'Counsellor' || n.cslr === u.id));
  return c.json({ items, unread: items.filter((n: any) => !n.read).length });
});
api.post('/notifications/read', async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const repo = c.get('repo');
  const sc = c.get('user').scope;
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 200)) {
    if (typeof id !== 'string') continue;
    const n = await repo.get<any>('notification', id);
    if (n && !n.read && (!n.branch || sc.includes(n.branch))) { n.read = true; await repo.put('notification', n); }
  }
  return c.json({ ok: true });
});
api.get('/audit', async (c) => {
  need(c, 'audit_logs', 'V');
  const where: string[] = []; const binds: unknown[] = [];
  if (c.req.query('ref')) { where.push('ref1=?'); binds.push(c.req.query('ref')); }
  return c.json(await list(c, 'audit', where, binds));
});
