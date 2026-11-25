// Meta Lead Ads – leadgen webhook + Graph API lead retrieval (Facebook & Instagram lead forms)
import type { Env } from '../types';
import { callApi, logMock, type Mode } from './base';

export interface MetaCtx { env: Env; cfg: any; mode: Mode; isTest?: boolean }

const graph = (env: Env) => `https://graph.facebook.com/${env.META_GRAPH_VERSION || 'v21.0'}`;

export interface LeadgenChange { leadgenId: string; formId?: string; pageId?: string; adId?: string; createdTime?: number }

export function parseLeadgenWebhook(body: any): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== 'leadgen') continue;
      const v = ch.value || {};
      out.push({ leadgenId: String(v.leadgen_id), formId: v.form_id && String(v.form_id), pageId: v.page_id && String(v.page_id), adId: v.ad_id && String(v.ad_id), createdTime: v.created_time });
    }
  }
  return out;
}

export async function fetchLead(m: MetaCtx, leadgenId: string, formId?: string) {
  if (m.mode === 'mock') {
    const res = {
      id: leadgenId, created_time: new Date().toISOString(), form_id: formId || 'MOCK_FORM', platform: 'fb', campaign_name: 'Meta Lead Form – AI Coding',
      field_data: [
        { name: 'full_name', values: ['Test Parent'] }, { name: 'student_name', values: ['Test Student'] },
        { name: 'phone_number', values: ['+971505559' + String(Math.floor(Math.random() * 900) + 100)] }, { name: 'email', values: ['test.parent@example.com'] },
        { name: 'child_age', values: ['11-15'] }, { name: 'interest', values: ['Robotics & Engineering'] },
        { name: 'utm_source', values: ['facebook'] }, { name: 'utm_medium', values: ['paid_social'] },
      ],
    };
    await logMock(m.env, 'meta', 'leadgen.get', { leadgenId }, res, leadgenId, m.isTest);
    return res;
  }
  const fields = 'id,created_time,field_data,ad_id,ad_name,campaign_name,form_id,platform';
  const r = await callApi(m.env, {
    integration: 'meta', operation: 'leadgen.get', url: `${graph(m.env)}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(m.env.META_PAGE_ACCESS_TOKEN || '')}`,
    ref: leadgenId, secrets: [m.env.META_PAGE_ACCESS_TOKEN],
  }, m.isTest);
  if (!r.ok) throw new Error(r.json?.error?.message || `Graph API HTTP ${r.status}`);
  return r.json;
}

const DEFAULT_MAP: Record<string, string> = {
  full_name: 'parent', parent_name: 'parent', parents_name: 'parent', student_name: 'student', child_name: 'student', childs_name: 'student',
  phone_number: 'phone', phone: 'phone', email: 'email', branch: 'branch', centre: 'branch', programme: 'prog', program: 'prog', course: 'prog',
  child_age: 'age', childs_age: 'age', child_age_range: 'age', age_range: 'age', age: 'age', interest: 'interest', interests: 'interest',
  utm_source: 'utm_source', utm_medium: 'utm_medium', utm_campaign: 'utm_campaign', utm_term: 'utm_term', utm_content: 'utm_content',
};
const UTM_LABELS = { source: 'UTM Source', medium: 'UTM Medium', campaign: 'UTM Campaign', term: 'UTM Term', content: 'UTM Content' };
const fieldKey = (name: string) => name.trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function submittedAt(createdTime: unknown, webhookTime?: number) {
  const graphTime = typeof createdTime === 'string' ? Date.parse(createdTime) : NaN;
  const timestamp = Number.isFinite(graphTime) ? graphTime : (webhookTime || 0) * 1000;
  const date = new Date(timestamp);
  return timestamp !== 0 && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Map a Graph API lead to CRM lead input. Form-level defaults come from cfg.integ.meta.forms[formId]. */
export function mapLead(cfg: any, lead: any, branches: any[], programs: any[], event?: LeadgenChange) {
  const configured = Object.entries<string>(cfg?.integ?.meta?.fieldMap || {});
  const fmap = new Map([...Object.entries(DEFAULT_MAP), ...configured.map(([name, target]): [string, string] => [fieldKey(name), target])]);
  const out = new Map<string, string>();
  for (const f of lead.field_data || []) {
    const key = fmap.get(fieldKey(String(f.name || '')));
    if (!key || !Array.isArray(f.values)) continue;
    const values = f.values.map((value: unknown) => String(value ?? '').trim()).filter(Boolean);
    if (values.length) out.set(key, key === 'interest' ? values.join(', ') : values[0]);
  }
  const formId = lead.form_id || event?.formId;
  const form = cfg?.integ?.meta?.forms?.[formId] || {};
  const pick = (val: string | undefined, list: any[]) => {
    if (!val) return undefined;
    const v = String(val).toLowerCase();
    return (list.find((x) => x.id.toLowerCase() === v || x.name.toLowerCase() === v || x.name.toLowerCase().includes(v)) || {}).id;
  };
  const branch = pick(out.get('branch'), branches) || form.branch || cfg?.integ?.meta?.defaultBranch || branches.find((b) => b.status === 'Operating')?.id;
  const prog = pick(out.get('prog'), programs) || form.prog || cfg?.integ?.meta?.defaultProg || 'COD';
  const childAge = out.get('age');
  const numericAge = Number(childAge);
  const age = Number.isInteger(numericAge) && numericAge >= 0 ? numericAge : undefined;
  const interest = out.get('interest');
  const notes: string[] = [];
  if (childAge && age === undefined) notes.push(`Child age: ${childAge}`);
  if (interest) notes.push(`Interest: ${interest}`);
  const utm: Record<string, string> = {};
  for (const [key, label] of Object.entries(UTM_LABELS)) {
    const value = out.get(`utm_${key}`);
    if (!value) continue;
    utm[key] = value;
    notes.push(`${label}: ${value}`);
  }
  return {
    student: out.get('student') || out.get('parent') || 'Meta lead',
    parent: out.get('parent') || out.get('student') || 'Unknown',
    phone: out.get('phone') || '',
    email: out.get('email') || '',
    age, enq: submittedAt(lead.created_time, event?.createdTime), notes: notes.join(' · '),
    branch, prog,
    src: lead.platform === 'ig' ? 'Instagram' : 'Facebook',
    camp: form.camp || lead.campaign_name || 'Meta Lead Form',
    cat: form.cat || 'Warm',
    // Meta lead forms include a privacy-policy consent; WhatsApp/e-mail consent follows the form's own question
    wa: form.waConsent !== false, em: form.emailConsent !== false,
    external: {
      metaLeadId: lead.id || event?.leadgenId, formId, adId: lead.ad_id || event?.adId,
      childAge, interest, utm: Object.keys(utm).length ? utm : undefined,
    },
  };
}

export async function me(m: MetaCtx) {
  if (m.mode === 'mock') {
    const res = { id: 'MOCK_PAGE', name: 'Lab of Future (mock)' };
    await logMock(m.env, 'meta', 'me.get', {}, res, undefined, m.isTest);
    return res;
  }
  const r = await callApi(m.env, { integration: 'meta', operation: 'me.get', url: `${graph(m.env)}/me?fields=id,name&access_token=${encodeURIComponent(m.env.META_PAGE_ACCESS_TOKEN || '')}`, secrets: [m.env.META_PAGE_ACCESS_TOKEN] }, m.isTest);
  if (!r.ok) throw new Error(r.json?.error?.message || `HTTP ${r.status}`);
  return r.json;
}
