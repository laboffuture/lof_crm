// Server-side business rules, ported 1:1 from the approved prototype so the API, webhooks and the
// screens behave the same way.
import { Repo, nowIso } from '../lib/db';
import { normPhone } from '../lib/indexing';
import { HttpError } from '../types';

export const TZ = 'Asia/Dubai';
export const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
export const r2 = (x: number) => Math.round(x * 100) / 100;
export const money = (a: number, c: string) => (c === 'INR' ? '₹ ' : (c || 'AED') + ' ') + Number(a || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------------- fees ----------------
export function feeFor(fees: any[], prog: string, branch: string, pkg?: string, today = dayKey(new Date())) {
  return fees.filter((f) => f.active && f.prog === prog && f.branch === branch && (!pkg || f.pkg === pkg) && f.from <= today && (!f.to || f.to >= today))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)) || String(b.revisionAt || '').localeCompare(String(a.revisionAt || '')) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }))[0];
}
/** GST set on a branch (India): CGST and SGST percentages. Null when the branch has none. */
export function branchGst(b: any): { cgst: number; sgst: number } | null {
  const has = (v: unknown) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
  if (!b || !has(b.cgst) || !has(b.sgst) || Number(b.cgst) + Number(b.sgst) <= 0) return null;
  return { cgst: Number(b.cgst), sgst: Number(b.sgst) };
}
/** Tax % for a fee: the branch's CGST + SGST when set, otherwise the fee's own tax %. */
export const taxPct = (fee: any, branch?: any) => { const g = branchGst(branch); return g ? r2(g.cgst + g.sgst) : Number(fee.tax) || 0; };
/** Why a branch's GST details are not valid ('' when they are). */
export function gstProblem(b: any): string {
  const gstin = String(b?.gstin ?? '').trim().toUpperCase(), pan = String(b?.pan ?? '').trim().toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return 'GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5';
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return 'PAN must be 10 characters, e.g. ABCDE1234F';
  if (gstin && pan && gstin.slice(2, 12) !== pan) return 'The PAN does not match the PAN inside the GSTIN (characters 3–12)';
  for (const k of ['cgst', 'sgst']) {
    const v = b?.[k];
    if (v !== undefined && v !== null && v !== '' && !(Number(v) >= 0 && Number(v) <= 50)) return `${k.toUpperCase()} must be a percentage from 0 to 50`;
  }
  const one = [b?.cgst, b?.sgst].filter((v) => v !== undefined && v !== null && v !== '').length;
  if (one === 1) return 'Enter both CGST and SGST, or neither';
  return '';
}

export function calcFee(fee: any, disc: any, isNew: boolean, branch?: any) {
  const base = fee.amt, extra = isNew ? fee.extra.amt : 0;
  let d = 0;
  if (disc) d = disc.type === '%' ? r2((base * disc.value) / 100) : Math.min(Number(disc.value), base);
  const pct = taxPct(fee, branch);
  const net = base - d + extra, tax = r2((net * pct) / 100);
  return { base, extra, disc: d, net, tax, total: r2(net + tax), taxPct: pct };
}

// ---------------- audit & notifications ----------------
async function auditStmt(repo: Repo, act: string, ref: string, det: string, by?: string) {
  const id = await repo.newId('audit');
  return repo.createStmt('audit', { id, at: nowIso(), by: by || repo.actor, act, ref, det });
}
export async function addAudit(repo: Repo, act: string, ref: string, det: string, by?: string) {
  await (await auditStmt(repo, act, ref, det, by)).run();
}
async function newNotification(repo: Repo, n: { type: string; sev: string; text: string; route: any; roles?: string[]; branch?: string | null; cslr?: string | null }) {
  const id = await repo.newId('notif');
  return { id, type: n.type, sev: n.sev, text: n.text, at: nowIso(), read: false, route: n.route, roles: n.roles, branch: n.branch ?? undefined, cslr: n.cslr ?? undefined };
}
export async function notify(repo: Repo, n: Parameters<typeof newNotification>[1]) {
  return repo.create('notification', await newNotification(repo, n));
}
/** Lead sources with no first-call SLA: a Manual lead is created by staff while the family is at the lab. Other follow-ups are unchanged. */
export const SLA_EXEMPT_SOURCES = ['Manual'];
export const needsFirstCall = (l: any) => !SLA_EXEMPT_SOURCES.includes(l?.src);

export const addEv = (l: any, type: string, text: string, by = 'System') => {
  l.events = l.events || [];
  l.events.push({ at: nowIso(), type, text, by });
  l.last = nowIso();
};

// ---------------- routing ----------------
export async function counsellorLoad(repo: Repo, cfg: any, cid: string) {
  // Test records (Testing Console) never count toward a real counsellor's workload
  const ls = await repo.many<any>('lead', 'owner=? AND status=? AND is_test=0', [cid, 'Open']);
  const o: any = { open: ls.length, Hot: 0, Warm: 0, Cold: 0, other: 0, w: 0 };
  for (const l of ls) {
    if (o[l.cat] != null) o[l.cat]++; else o.other++;
    o.w += weight(cfg, l.cat);
  }
  return o;
}
export const weight = (cfg: any, cat: string) => {
  const w = cfg.routing?.weights?.[cat];
  return w == null ? 1 : w;
};

export async function eligibility(repo: Repo, cfg: any, branch: string, prog: string, cat: string) {
  const R = cfg.routing;
  const staff = (await repo.many<any>('staff', 'owner=?', ['Counsellor'])).filter((s) => s.status === 'Active');
  const rows: { s: any; L: any; why: string }[] = [];
  for (const s of staff) {
    const L = await counsellorLoad(repo, cfg, s.id);
    const w = weight(cfg, cat);
    let why = '';
    if (R.branchElig && s.branch !== branch) why = 'Different branch';
    else if (R.programRouting && !s.programs.includes(prog)) why = 'Programme not handled';
    else if (s.avail !== 'Available' && String(R.absence).startsWith('Skip')) why = 'On leave / unavailable';
    else if (L.w + w > s.max) why = `Workload limit (${L.w} + ${w} > ${s.max})`;
    rows.push({ s, L, why });
  }
  return rows;
}

export async function routeLead(repo: Repo, cfg: any, branch: string, prog: string, cat: string, statements?: D1PreparedStatement[]) {
  const rows = await eligibility(repo, cfg, branch, prog, cat);
  const ok = rows.filter((r) => !r.why).sort((a, b) => (a.s.id < b.s.id ? -1 : 1));
  let pick: any = null;
  if (ok.length) {
    if (cfg.routing.method === 'Round-robin') {
      const rr = await repo.setting<Record<string, string>>('rr_last');
      const last = rr[branch] || '';
      pick = ok.find((r) => r.s.id > last) || ok[0];
      rr[branch] = pick.s.id;
      const update = repo.putSettingStmt('rr_last', rr);
      if (statements) statements.push(update);
      else await update.run();
    } else {
      pick = ok.slice().sort((a, b) => a.L.w / a.s.max - b.L.w / b.s.max || a.L.w - b.L.w)[0];
    }
  }
  return { pick: pick ? pick.s : null, rows };
}

// ---------------- duplicates ----------------
export async function findDup(repo: Repo, phone: string, email: string) {
  const ph = normPhone(phone), em = String(email || '').trim().toLowerCase();
  const out: any[] = [];
  const leads = await repo.many<any>('lead', '(ref1=? OR (ref2=? AND ref2 IS NOT NULL AND ref2<>\'\'))', [ph || '#', em || '#']);
  for (const l of leads) out.push({ kind: 'Lead', id: l.id, name: `${l.student} / ${l.parent}`, branch: l.branch, status: l.status });
  if (ph || em) {
    // D1 limits LIKE pattern length, which can be shorter than a valid email address.
    const candidates = await repo.many<any>('student', "(instr(data, NULLIF(?, '')) > 0 OR instr(lower(data), NULLIF(?, '')) > 0)", [ph, em]);
    for (const s of candidates) {
      const hit = (s.parents || []).find((p: any) => (ph && normPhone(p.mobile) === ph) || (em && String(p.email).toLowerCase() === em));
      if (hit) out.push({ kind: 'Student', id: s.id, name: `${s.first} ${s.last} / ${hit.name}`, branch: s.branch, status: s.status });
    }
  }
  return out;
}

// ---------------- messaging templates ----------------
export function msgFrom(t: string, l: any, ctx: { progName: string; branchName: string; counsellor: string; sid?: string }) {
  return String(t)
    .replace(/\{parent_name\}/g, l.parent)
    .replace(/\{student_name\}/g, l.student)
    .replace(/\{programme\}/g, ctx.progName)
    .replace(/\{branch\}/g, ctx.branchName)
    .replace(/\{counsellor\}/g, ctx.counsellor)
    .replace(/\{student_id\}/g, ctx.sid || '');
}
/** Ordered placeholder values – used as WhatsApp template body parameters. */
export function templateParams(t: string, l: any, ctx: { progName: string; branchName: string; counsellor: string; sid?: string }) {
  const map: Record<string, string> = {
    parent_name: l.parent, student_name: l.student, programme: ctx.progName, branch: ctx.branchName, counsellor: ctx.counsellor, student_id: ctx.sid || '',
  };
  return [...String(t).matchAll(/\{(\w+)\}/g)].map((m) => map[m[1]] ?? '');
}

// ---------------- lead creation (webhooks, API, tests) ----------------
export interface NewLeadInput {
  student: string; parent: string; phone: string; email?: string; branch: string; prog: string; src: string;
  camp?: string; cat?: string; dob?: string; age?: number; school?: string; grade?: string; curr?: string;
  wa?: boolean; em?: boolean; notes?: string; cslr?: string; enq?: string; external?: Record<string, unknown>;
}

/** opts.quiet: no per-lead notification (bulk import sends one summary); opts.noAutoMessages: no automatic welcome WhatsApp / e-mail. */
export async function createLead(repo: Repo, input: NewLeadInput, by = 'System', opts: {
  quiet?: boolean;
  noAutoMessages?: boolean;
  allowUnrouted?: boolean;
  webhookEvent?: { provider: string; id: string };
} = {}) {
  const cfg = await repo.setting<any>('cfg');
  const pendingRouting = !!opts.allowUnrouted && (!input.branch || !input.prog);
  const branch = input.branch ? await repo.get<any>('branch', input.branch) : null;
  if (!branch && (!pendingRouting || input.branch)) throw new HttpError(422, `Unknown branch ${input.branch}`);
  if (branch && (!pendingRouting || input.prog) && !branch.programs.includes(input.prog))
    throw new HttpError(422, `Programme ${input.prog} is not offered at ${branch.name}`);
  const src = (cfg.sources || []).find((s: any) => s.n === input.src);
  if (src && !src.en) throw new HttpError(422, `Lead creation from ${input.src} is disabled in configuration`);

  const id = await repo.newId('lead');
  const statements: D1PreparedStatement[] = [];
  if (opts.webhookEvent) {
    // The unique event key and the lead commit together, so a failed request can be retried.
    statements.push(repo.db.prepare('INSERT INTO webhook_events (provider,event_id,result) VALUES (?,?,?)')
      .bind(opts.webhookEvent.provider, opts.webhookEvent.id, id));
  }
  const now = nowIso();
  const l: any = {
    id, student: input.student, age: input.age || 0, dob: input.dob || '', parent: input.parent, phone: input.phone, email: input.email || '',
    branch: input.branch, prog: input.prog, src: input.src, camp: input.camp || '—', cat: input.cat || 'Warm', stage: 'New Lead', cslr: null,
    enq: input.enq || now, fc: null, status: 'Open', noResp: 0, nextFU: null, last: now, school: input.school || '', grade: input.grade || '',
    curr: input.curr || '', wa: !!input.wa, em: !!input.em, notes: input.notes || '', origCat: null, closeReason: '', lostReason: '',
    events: [], assign: [], avail: null, custom: {}, external: input.external || undefined, test: repo.isTest || undefined,
  };
  l.events.push({ at: l.enq, type: 'sys', text: `Lead created from ${l.src}${l.camp && l.camp !== '—' ? ' · ' + l.camp : ''}`, by });

  const dups = await findDup(repo, l.phone, l.email);
  if (dups.length) l.events.push({ at: now, type: 'warn', text: `Possible duplicate of ${dups.map((d) => d.id).join(', ')} (matched on phone or e-mail)`, by: 'System' });

  let rt: any = null;
  if (pendingRouting) {
    l.events.push({ at: now, type: 'sys', text: 'Website lead needs a branch or programme before it can be assigned', by: 'System' });
  } else if (input.cslr) {
    l.cslr = input.cslr;
    l.assign.push({ at: now, from: '', to: input.cslr, by, how: 'Manual', reason: 'Selected at creation' });
  } else {
    rt = await routeLead(repo, cfg, l.branch, l.prog, l.cat, statements);
    if (rt.pick) {
      l.cslr = rt.pick.id;
      l.assign.push({ at: now, from: '', to: rt.pick.id, by: 'Routing rules', how: `Auto (${cfg.routing.method})`, reason: 'New lead' });
      l.events.push({ at: now, type: 'sys', text: `Auto-assigned to ${rt.pick.name} (${cfg.routing.method})`, by: 'System' });
    } else {
      l.events.push({ at: now, type: 'crit', text: `No eligible counsellor – lead placed in Unassigned queue; ${cfg.routing.notifyNone} notified`, by: 'System' });
    }
  }
  const progName = ((await repo.get<any>('program', l.prog)) || { name: l.prog }).name;
  const cslrName = l.cslr ? ((await repo.get<any>('staff', l.cslr)) || { name: 'our team' }).name : 'our team';
  const ctx = { progName, branchName: branch?.name || '', counsellor: cslrName };

  const queuedComms: string[] = [];
  for (const [tid, key] of [['T1', 'wa'], ['T2', 'wa'], ['T3', 'em']] as const) {
    const t = (cfg.comms || []).find((x: any) => x.id === tid);
    if (!t || !t.auto || opts.noAutoMessages || pendingRouting) continue;
    const blocked = cfg.consentReq?.[key] && !l[key];
    const cid = await repo.newId('cm');
    statements.push(await repo.createStmt('comm', {
      id: cid, lead: id, ch: t.ch, tpl: t.n, tplId: t.id,
      text: blocked ? `Not sent – no ${key === 'wa' ? 'WhatsApp' : 'email'} consent recorded` : msgFrom(t.body, l, ctx),
      at: nowIso(), status: blocked ? 'Blocked – no consent' : 'Queued', by: 'System', test: repo.isTest || undefined,
    }, l.branch));
    if (!blocked) {
      queuedComms.push(cid);
      if (tid === 'T2') l.avail = { s: 'Requested', slot: null };
      l.events.push({ at: nowIso(), type: 'msg', text: `${t.ch} "${t.n}" queued`, by: 'System' });
    }
  }
  if (l.cslr) {
    if (needsFirstCall(l)) {
      const tid = await repo.newId('task');
      statements.push(await repo.createStmt('task', { id: tid, lead: id, cslr: l.cslr, due: new Date(Date.now() + cfg.sla.mins * 6e4).toISOString(), type: 'First call', status: 'Pending', remarks: 'First-call SLA task', outcome: '', next: '', test: repo.isTest || undefined }, l.branch));
    }
  }
  if (!opts.quiet) {
    const notification = pendingRouting
      ? { type: 'new', sev: 'info', text: 'Website lead needs routing: ' + l.student, route: { page: 'lead', id }, roles: branch ? ['Centre Administrator', 'Admissions Head', 'System Administrator', 'Management'] : ['System Administrator', 'Management'], branch: l.branch }
      : l.cslr
      ? { type: 'new', sev: 'info', text: `New lead created: ${l.student} (${l.src}) – assigned to ${cslrName}`, route: { page: 'lead', id }, roles: ['Counsellor', 'Centre Administrator'], branch: l.branch, cslr: l.cslr }
      : { type: 'none', sev: 'crit', text: `No counsellor available: ${l.student} (${ctx.branchName} · ${progName}) – lead in Unassigned queue`, route: { page: 'leads', preset: 'unassigned' }, roles: ['Admissions Head', 'Centre Administrator', 'System Administrator'], branch: l.branch };
    statements.push(await repo.createStmt('notification', await newNotification(repo, notification)));
  }
  statements.push(await repo.createStmt('lead', l));
  statements.push(await auditStmt(repo, 'Lead created', id, `Source ${l.src}; assigned to ${cslrName === 'our team' ? 'Unassigned' : cslrName}`, by));
  await repo.db.batch(statements);
  return { lead: l, route: rt, queuedComms, duplicates: dups };
}

// ---------------- payments ----------------
/** Record a payment against an enrollment; the server assigns the receipt number. */
export async function recordPayment(
  repo: Repo,
  p: { enr: string; amt: number; method: string; ref: string; at?: string; by: string; gateway?: any; id?: string },
) {
  const e = await repo.get<any>('enrollment', p.enr);
  if (!e) throw new Error('Enrollment not found');
  const out = r2(e.total - e.paid);
  if (!(p.amt > 0)) throw new Error('Amount must be greater than zero');
  if (p.amt > out + 0.005) throw new Error(`Amount exceeds the outstanding balance (${money(out, e.cur)})`);
  const id = p.id || (await repo.newId('pay'));
  const rcN = repo.isTest || e.test ? 0 : await repo.next('rc_' + e.branch);
  const pay: any = {
    id, enr: e.id, stu: e.stu, amt: r2(p.amt), cur: e.cur, method: p.method, ref: p.ref || '—', at: p.at || nowIso(),
    rc: rcN ? `RC-${e.branch}-26-${String(rcN).padStart(4, '0')}` : `RC-TEST-${id}`, status: 'Recorded', by: p.by, branch: e.branch,
    gateway: p.gateway, test: repo.isTest || undefined,
  };
  await repo.create('payment', pay);
  await recalcEnrollment(repo, e.id);
  return pay;
}

export async function recalcEnrollment(repo: Repo, enrId: string) {
  const e = await repo.get<any>('enrollment', enrId);
  if (!e) return null;
  // Cancelled payments keep their receipt number but no longer count towards what was paid
  const pays = (await repo.many<any>('payment', 'ref1=?', [enrId])).filter((p) => p.status !== 'Cancelled');
  e.paid = r2(pays.reduce((a, p) => a + Number(p.amt || 0), 0));
  e.payStatus = e.paid >= e.total - 0.005 ? 'Paid' : e.paid > 0 ? 'Partially paid' : 'Unpaid';
  await repo.put('enrollment', e);
  return e;
}
