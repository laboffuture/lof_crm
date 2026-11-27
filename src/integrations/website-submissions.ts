import type { Repo } from '../lib/db';
import { HttpError } from '../types';
import type { NewLeadInput } from '../domain/core';

export const WEBSITE_SUBMISSIONS = ['website-submissions', 'website-submissions-test'] as const;
export const WEBSITE_SUBMISSION_MAX_BYTES = 32_768;

const learnerFields = ['parentName', 'learnerName', 'studentName', 'phone', 'email', 'dob', 'program'];
const enquiryFields = [...learnerFields, 'heardFrom', 'message'];
const formFields: Record<string, string[]> = {
  registration: [...enquiryFields, 'preferredLocation'],
  'enquiry-learner': enquiryFields,
  'book-a-demo': [...learnerFields, 'preferredDate', 'preferredTime'],
  'community-registration': ['firstName', 'lastName', 'email', 'phone', 'dob', 'country', 'school', 'heardFrom'],
  'competition-enquiry': [...enquiryFields, 'competition'],
  'internship-application': ['contactName', 'phone', 'email', 'dob', 'applicantType', 'internship', 'institution', 'motivation', 'pathway'],
  'about-us-enquiry': ['name', 'age', 'gender', 'phone', 'email', 'program', 'question', 'fileName'],
  'orbita-application': ['contactName', 'dob', 'institution', 'email', 'whatsapp'],
  'store-unlock': ['contactName', 'email', 'phone', 'role', 'content'],
};

const notesLabels: Record<string, string> = {
  program: 'Website programme', preferredLocation: 'Preferred location', heardFrom: 'Heard from',
  preferredDate: 'Preferred date', preferredTime: 'Preferred time', country: 'Country',
  competition: 'Competition', applicantType: 'Applicant type', internship: 'Internship', pathway: 'Pathway',
  motivation: 'Motivation', gender: 'Gender', fileName: 'Attachment filename', question: 'Question', message: 'Message',
  role: 'Store requester role', content: 'Requested store content',
};

const fieldLabels: Record<string, string> = {
  submission_id: 'submission ID', form: 'form type', page: 'website page', data: 'form details',
  submitted_at: 'submission date and time', source: 'lead source',
  email: 'email address', phone: 'phone number', whatsapp: 'WhatsApp number', dob: 'date of birth',
  program: 'programme', heardFrom: 'referral source',
};

const fieldLabel = (key: string) => fieldLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase().replace(/^utm /, 'UTM ');
const formatFields = new Intl.ListFormat('en');

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, `The ${fieldLabel(path)} must be sent as a JSON object.`, { field: path });
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown>, key: string, max: number, numeric = false, path = key): string {
  const value = record[key];
  if (value == null) return '';
  if (typeof value !== 'string' && !(numeric && Number.isSafeInteger(value)))
    throw new HttpError(400, `Please enter the ${fieldLabel(key)} as ${numeric ? 'text or a whole number' : 'text'}.`, { field: path });
  const text = String(value).trim();
  if (text.length > max) throw new HttpError(400, `The ${fieldLabel(key)} must be ${max} characters or fewer.`, { field: path });
  return text;
}

function enquiryTime(value: string) {
  if (!value) return undefined;
  const parsed = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const time = new Date(value);
  if (!parsed || !Number.isFinite(time.getTime()) || new Date(parsed[1] + 'Z').toJSON()?.slice(0, 19) !== parsed[1])
    throw new HttpError(400, 'Please provide a valid submission date and time, including the time zone.', { field: 'submitted_at' });
  return time.toISOString();
}

const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

export function parseWebsiteSubmission(value: unknown) {
  const body = object(value, 'Request');
  const missing = ['submission_id', 'form', 'page', 'data'].filter((key) => {
    const input = body[key];
    return input == null || (typeof input === 'string' && !input.trim());
  });
  if (missing.length) throw new HttpError(400, `Please provide the ${formatFields.format(missing.map(fieldLabel))}.`, { missing });
  const submissionId = field(body, 'submission_id', 200, true);
  const form = field(body, 'form', 80);
  const page = field(body, 'page', 250);
  if (!Object.hasOwn(formFields, form)) throw new HttpError(400, 'Please select a supported form type.', { field: 'form', allowed: Object.keys(formFields) });
  if (!/^\/(?!\/)[^\s?#\\]*$/.test(page)) throw new HttpError(400, 'Please use a website page path such as /students.', { field: 'page' });
  const raw = object(body.data, 'data');
  const allowedFields = formFields[form];
  const data: Record<string, string> = {};
  for (const key of allowedFields) {
    const long = ['motivation', 'message', 'question'].includes(key);
    const text = field(raw, key, long ? 2_000 : 254, ['phone', 'whatsapp', 'age'].includes(key), `data.${key}`);
    if (text) data[key] = text;
  }

  const learnerName = data.learnerName || data.studentName || data.name || data.contactName ||
    [data.firstName, data.lastName].filter(Boolean).join(' ') || data.parentName;
  const email = data.email || '';
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new HttpError(400, 'Please enter a valid email address.', { field: 'data.email' });
  let phone = data.phone || data.whatsapp || '';
  const digits = phone.replace(/[\s()-]/g, '');
  // Optional community phone fields are initialized with a dialling code.
  if (form === 'community-registration' && /^\+\d{1,3}$/.test(digits)) phone = '';
  else if (phone && !/^\+?\d{7,15}$/.test(digits)) {
    const key = data.phone ? 'phone' : 'whatsapp';
    throw new HttpError(400, `Please enter a ${fieldLabel(key)} with 7 to 15 digits.`, { field: `data.${key}` });
  }
  if (!learnerName || (!phone && !email)) {
    const paths = (keys: string[]) => keys.filter((key) => allowedFields.includes(key)).map((key) => `data.${key}`);
    const requiredAnyOf: { name?: string[]; contact?: string[] } = {};
    const messages: string[] = [];
    if (!learnerName) {
      requiredAnyOf.name = paths(['learnerName', 'studentName', 'name', 'contactName', 'firstName', 'lastName', 'parentName']);
      messages.push(allowedFields.includes('parentName') ? 'Please enter the learner’s or parent’s name.' : 'Please enter your name.');
    }
    if (!phone && !email) {
      requiredAnyOf.contact = paths(['phone', 'whatsapp', 'email']);
      messages.push(allowedFields.includes('whatsapp')
        ? 'Please enter a WhatsApp number or an email address.' : 'Please enter a phone number or an email address.');
    }
    throw new HttpError(400, messages.join(' '), { requiredAnyOf });
  }

  const dob = data.dob || '';
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || new Date(dob + 'T00:00:00Z').toJSON()?.slice(0, 10) !== dob))
    throw new HttpError(400, 'Please enter a valid date of birth in year-month-day format.', { field: 'data.dob' });
  const age = data.age && /^\d{1,2}$/.test(data.age) ? Number(data.age) : undefined;
  const utm: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
    const text = field(body, 'utm_' + key, 200);
    if (text) utm[key] = text;
  }
  const branch = field(body, 'branch', 60);
  const programme = field(body, 'programme', 60);
  const source = field(body, 'source', 200);
  const enq = enquiryTime(field(body, 'submitted_at', 35));
  const notes = Object.entries(notesLabels).filter(([key]) => data[key]).map(([key, label]) => `${label}: ${data[key]}`);
  if (utm.source) notes.push('UTM Source: ' + utm.source);

  return {
    submissionId, branch, programme, source, location: data.preferredLocation, programmeLabel: data.program,
    input: {
      student: learnerName, parent: data.parentName || '', phone, email, dob, age, school: data.school || data.institution,
      enq, camp: utm.campaign, notes: notes.join(' · '),
      external: {
        website: { submissionId, form, page, data, ...(branch ? { branch } : {}), ...(programme ? { programme } : {}) },
        ...(Object.keys(utm).length ? { utm } : {}),
      },
    } satisfies Omit<NewLeadInput, 'branch' | 'prog' | 'src'>,
  };
}

export async function websiteLeadRoute(repo: Repo, submission: ReturnType<typeof parseWebsiteSubmission>) {
  const [branches, programmes] = await Promise.all([repo.many<any>('branch'), repo.many<any>('program')]);
  const one = (records: any[], label: string | undefined, explicit: boolean) => {
    if (!label) return undefined;
    const value = normalize(label);
    if (!value) return undefined;
    const matches = records.filter((record) => [record.id, record.code, ...(explicit ? [] : [record.name])]
      .some((candidate) => normalize(candidate) === value));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const branch = one(branches.filter((b) => b.status === 'Operating' && !b.archived && !b.test),
    submission.branch || submission.location, !!submission.branch);
  const programme = one(programmes.filter((p) => p.active && !p.test),
    submission.programme || submission.programmeLabel, !!submission.programme);
  return {
    branch: branch?.id || '',
    prog: programme && (!branch || branch.programs.includes(programme.id)) ? programme.id : '',
  };
}
