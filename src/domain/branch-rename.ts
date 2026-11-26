// Change a branch's Short ID and move every record that points at it, in one transaction.
// System Administrator only (routes/admin.ts). On by default outside production (UAT, local); on the live site only
// while ALLOW_BRANCH_ID_EDIT=true.
// Left unchanged on purpose: the audit log (append-only history) and receipt numbers already issued (RC-OLD-26-0001).
import type { Repo } from '../lib/db';
import { HttpError, type Env } from '../types';

export const BRANCH_ID_RE = /^[A-Z0-9]{2,5}$/;
export const branchIdEditable = (env: Env) => env.ALLOW_BRANCH_ID_EDIT === 'true' || env.APP_ENV !== 'production';

export async function renameBranch(repo: Repo, fromRaw: unknown, toRaw: unknown) {
  const from = String(fromRaw ?? '')
    .trim()
    .toUpperCase();
  const to = String(toRaw ?? '')
    .trim()
    .toUpperCase();
  if (!BRANCH_ID_RE.test(to)) throw new HttpError(422, 'Branch short ID must be 2–5 capital letters or digits');
  if (from === to) throw new HttpError(422, 'The new Short ID is the same as the current one');
  const db = repo.db;
  if (!(await repo.getRow('branch', from))) throw new HttpError(404, 'Branch not found');
  if (await repo.getRow('branch', to)) throw new HttpError(409, `Short ID ${to} is already used by another branch`);
  const stray = await db
    .prepare("SELECT COUNT(*) n FROM docs WHERE branch=? AND type<>'audit'")
    .bind(to)
    .first<{ n: number }>();
  if (stray?.n) throw new HttpError(409, `${stray.n} records already point at ${to} – choose another Short ID`);

  // Settings that hold branch ids: cfg (e-mail in, templates, LMS mapping), scope (staff access), hist (targets)
  const cfg = await repo.setting<any>('cfg');
  const scope = await repo.setting<Record<string, string[]>>('scope');
  const hist = await repo.setting<Record<string, unknown>>('hist');
  if (cfg.mailIn?.branch === from) cfg.mailIn.branch = to;
  for (const t of cfg.emailTpls || []) if (t?.branch === from) t.branch = to;
  if (cfg.lms?.branchMap && from in cfg.lms.branchMap) {
    cfg.lms.branchMap[to] = cfg.lms.branchMap[from];
    delete cfg.lms.branchMap[from];
  }
  for (const k of Object.keys(scope))
    if (Array.isArray(scope[k])) scope[k] = scope[k].map((b) => (b === from ? to : b));
  if (from in hist) {
    hist[to] = hist[from];
    delete hist[from];
  }

  const touch = "version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=?";
  const res = await db.batch([
    db
      .prepare(
        `UPDATE docs SET id=?, branch=CASE WHEN branch=? THEN ? ELSE branch END, data=json_set(data,'$.id',?), ${touch} WHERE type='branch' AND id=?`,
      )
      .bind(to, from, to, to, repo.actor, from),
    db
      .prepare(
        `UPDATE docs SET branch=CASE WHEN branch=? THEN ? ELSE branch END,
           data=CASE WHEN json_extract(data,'$.branch')=? THEN json_set(data,'$.branch',?) ELSE data END, ${touch}
         WHERE type NOT IN ('audit','branch') AND (branch=? OR json_extract(data,'$.branch')=?)`,
      )
      .bind(from, to, from, to, repo.actor, from, from),
    db
      .prepare(
        `UPDATE docs SET data=json_set(data,'$.payload.from',?), ${touch} WHERE type='approval' AND json_extract(data,'$.payload.from')=?`,
      )
      .bind(to, repo.actor, from),
    db
      .prepare(
        `UPDATE docs SET data=json_set(data,'$.payload.to',?), ${touch} WHERE type='approval' AND json_extract(data,'$.payload.to')=?`,
      )
      .bind(to, repo.actor, from),
    db.prepare('UPDATE call_events SET branch=? WHERE branch=?').bind(to, from),
    // Receipt numbering continues where it was, now as RC-NEW-…
    db
      .prepare('UPDATE sequences SET name=? WHERE name=? AND NOT EXISTS (SELECT 1 FROM sequences WHERE name=?)')
      .bind('rc_' + to, 'rc_' + from, 'rc_' + to),
    repo.putSettingStmt('cfg', cfg),
    repo.putSettingStmt('scope', scope),
    repo.putSettingStmt('hist', hist),
  ]);
  return { from, to, records: res[1].meta.changes ?? 0 };
}
