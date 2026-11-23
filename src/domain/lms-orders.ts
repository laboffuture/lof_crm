import { Repo, nowIso } from '../lib/db';

export const LMS_CONTRACT = '2026-11-v1.1';

/** Only orders created by the new workflow are eligible; historical records are never backfilled. */
export async function activatePaidLms(repo: Repo, e: any): Promise<string[]> {
  if (e.lmsContract !== LMS_CONTRACT || e.status === 'Withdrawn' || e.payStatus !== 'Paid') return [];
  const calls = await repo.many<any>('moodle_sync', 'ref1=?', [e.id]);
  const ids: string[] = [];
  for (const m of calls) {
    if (m.op === 'cancel' || m.status !== 'Awaiting Payment') continue;
    const at = nowIso();
    const claim = await repo.db
      .prepare(
        "UPDATE docs SET status='Pending', data=json_insert(json_set(data,'$.status','Pending','$.last',?),'$.hist[#]',json(?)) WHERE type='moodle_sync' AND id=? AND status='Awaiting Payment'",
      )
      .bind(at, JSON.stringify({ at, s: 'Pending', msg: 'Order fully paid; purchase queued for LMS' }), m.id)
      .run();
    if (claim.meta.changes) ids.push(m.id);
  }
  return ids;
}
