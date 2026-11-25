# Lab of Future CRM

The approved LOF CRM prototype, turned into a working system on **Cloudflare Workers + D1**:

- **API** (Hono) with sign-in, branch-scoped data, role permissions and an audit trail
- **Integrations**: Website form, Meta Lead Ads, WhatsApp Cloud API, Exotel, LMS (LOF booking platform), Easebuzz (sole online gateway; AED multicurrency setup pending), ERPNext Accounts, Google Calendar, e-mail (SMTP) – each with a **mock mode** so everything can be tested before credentials exist
- **Testing module**: an in-app **Testing console** (Settings → Testing console)
- **Frontend**: the prototype screens, unchanged in look and workflow, wired to the API by `public/api-client.js`

```
public/                 index.html (generated from the prototype), api-client.js, embed/lead-form.js
src/index.ts            Worker entry: routes, cron (every 5 min), queue consumer
src/routes/             auth · api (REST + sync) · webhooks · testing · receipt
src/sync/               bootstrap (scoped state) · sync (permission-guarded writes)
src/domain/             core business rules · workflows (LMS calls, messages, ERPNext, payment links) · terms (instalments, refund rules, LMS payload)
src/integrations/       one adapter per provider, live + mock
src/jobs.ts             background jobs and scheduler
migrations/             schema, generated seed, reporting views and data integrity updates
prototype/              the original approved prototype (source for index.html and the seed)
```

## How it works

**Data.** Every record (lead, opportunity, student, enrolment, payment …) is stored in D1 as the same JSON document the screens use, with indexed columns for branch, status, owner and lookups. Reporting views (`v_leads`, `v_payments`, `v_enrollments` …) give flat tables for SQL and BI tools.

**Writes from the screens.** The screens keep their workflow logic. After each action the browser sends the changed records to `PUT /api/v1/sync`. The server is the authority and applies, all-or-nothing:

| Check | Example |
|---|---|
| Role permission (from Roles & Permissions) | Reception cannot edit leads; only configuration roles change settings |
| Branch scope | A Karama counsellor cannot touch Sports City records |
| Approval rules | Branch changes only via an approved transfer; approver must be the configured role, not the requester |
| Fee integrity | The enrolment total is recomputed from the fee master and discount; mismatches are rejected |
| Money | Payments cannot exceed the balance, cannot be edited, get **server receipt numbers** (gapless per branch) |
| Consent | WhatsApp / e-mail without consent are stored as *Blocked* and never sent |
| Audit | Append-only; user and time are stamped by the server |

Accepted changes trigger real work: queued messages go to WhatsApp / e-mail, new enrolments send the LMS enrol call (withdrawals send the cancel call), payments post to ERPNext, follow-ups go to Google Calendar.

**Record numbers** (LD-26-…, OP-26-…, LOF-26-…, PY-26-…) come from server sequences, so two users never get the same number. Test records use `TST-…` numbers and never consume business numbering.

**Integration modes.** With `INTEGRATION_MODE=auto` an integration runs **live** when it is enabled under Configuration → Integrations **and** all its secrets are set; otherwise it runs in **mock** mode (realistic responses, logged like real calls). `INTEGRATION_MODE=mock` forces mock everywhere (staging, demos). Every outbound call and inbound webhook is logged with secrets redacted.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars          # local secrets; integrations stay in mock mode
npm run build                            # index.html from the prototype + seed SQL from its demo data
npm run db:migrate:local
npm run dev                              # http://127.0.0.1:8787
```

Sign in with any demo staff e-mail and the password `Welcome@LOF2026` (you'll be asked to change it; in production *System Administrator* and *Management* must also set up two-step verification), e.g.

| Role | E-mail |
|---|---|
| System Administrator | vikram.sethi@example.com |
| Management | khalid.rahman@example.com |
| Admissions Head (UAE / India) | nadia.farouk@example.com / deepa.krishnan@example.com |
| Centre Administrator (Karama) | hassan.ali@example.com |
| Counsellor (Karama / Sports City) | priya.nair@example.com / fatima.khan@example.com |
| Reception | layla.haddad@example.com |

`/?demo=1` opens the original offline prototype (nothing is saved).

For production, generate a seed with masters only (branches, programmes, fees, discounts, staff, settings):
`node scripts/build-seed.mjs --masters-only` – then replace the example staff with real people before migrating.

## Validation

Run the repository checks with:

```bash
npm run typecheck
npm run check:frontend
```

### Testing console (Settings → Testing console, System Administrator)

- **Integration readiness** – per integration: configuration toggle, live/mock, missing secrets, webhook URL to register, last result, *Test connection*
- **End-to-end scenarios** – *UAE enquiry → enrolment → counter payment*, *India enquiry → enrolment → counter payment*, *Easebuzz sandbox checkout*, *Meta lead import*, *LMS outage and retry* – step-by-step pass/fail
- **Webhook simulations** – correctly signed provider events sent through the real endpoints
- **Failure injection** – simulate an LMS outage
- **Integration log** – every request/response, secrets redacted
- **Run scheduler now** and **Delete test data**

Everything the console creates is flagged as test data, hidden from other users, excluded from counsellor workload and removable in one click.

## Deploy

**Step-by-step guide: [DEPLOY.md](DEPLOY.md).** In short – with a Cloudflare account ID and API token:

```bash
./deploy.sh          # macOS / Linux   (Windows: .\deploy.ps1)
```

or run the GitHub Actions workflow *Deploy to Cloudflare*. Both check TypeScript types, create the database and queues if
missing, apply new migrations, keep existing secrets and data, create the first administrator, and check `/health`.
Staging: add `--env staging` (forced mock mode, own database). Set `APP_BASE_URL` to the public URL when you use a
custom domain – webhook and payment return URLs are built from it.

## Checking the data

- **Settings → Database** (System Administrator): every table with row counts, search, branch and test-record
  filters, full record view, CSV export and a full JSON backup. Read-only; passwords, two-step secrets and session
  tokens are never selected; exports are rate-limited and audited. API: `/api/v1/admin/db/*` (see docs/API.md).
- **SQL views** for wrangler, the D1 console or BI tools: `v_leads`, `v_opportunities`, `v_students`,
  `v_enrollments`, `v_instalments`, `v_payments`, `v_refunds`, `v_lms_calls`, `v_approvals`, `v_tasks`, `v_calls`,
  `v_staff`, `v_targets`, `v_audit` – e.g. `npx wrangler d1 execute lof_crm --remote --command "SELECT * FROM v_instalments"`.
- **Restore** a JSON backup: `node scripts/restore-backup.mjs backup.json > restore.sql` then
  `npx wrangler d1 execute lof_crm --remote --file restore.sql`.

## Go-live checklist per integration

Set the secrets (`wrangler secret put …`), set the variables in `wrangler.toml`, enable the integration under **Configuration → Integrations**, then use **Test connection** and the scenarios in the Testing console.

| Integration | Secrets / variables | Register with the provider |
|---|---|---|
| **Website form** | `WEBSITE_FORM_SECRET`; allowed origins in Configuration | Embed `public/embed/lead-form.js`, or POST JSON to `/webhooks/website` with `X-LOF-Signature` = hex HMAC-SHA256 of the body |
| **Meta Lead Ads** | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` (page token with `leads_retrieval`) | App webhook, object *Page*, field *leadgen* → `/webhooks/meta`; subscribe the page. Map form IDs to branch/programme in `cfg.integ.meta.forms` (default branch/programme in Configuration) |
| **WhatsApp** | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (system user), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Webhook `/webhooks/whatsapp`, field *messages*. Get templates approved and enter their names on each CRM template (Configuration → Communication); placeholders are sent as body parameters in order |
| **Exotel** | `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID`, `EXOTEL_WEBHOOK_TOKEN`, `EXOTEL_SUBDOMAIN` | In the incoming-call flow add a *Passthru* applet → `/webhooks/exotel/incoming?token=…` and set the Connect applet's status callback → `/webhooks/exotel/status?token=…`. Each counsellor needs a mobile number on their staff record (click-to-call rings it first) |
| **LMS** (LOF booking platform) | `LMS_URL` (variable), `LMS_TOKEN` (secret); codes under **Settings → LMS Integration** | POST to `crm_api.php` with a JSON body containing `wstoken` and `wsfunction`. Legacy `server.php` URLs retain form encoding with `moodlewsrestformat=json`. Supports purchase, cancel, catalogue (connection check) and student lookup. An acknowledgement confirms receipt; LOF staff process orders to create accounts and grant access. See [LMS setup](docs/LMS-Integration.md). |
| **Easebuzz** | `EASEBUZZ_ENV`, `EASEBUZZ_KEY`, `EASEBUZZ_SALT`; enable Payment gateway in Settings | Notification endpoint `/webhooks/easebuzz`; browser return `/webhooks/easebuzz/return`. Use `test` with sandbox credentials on a non-production CRM and `prod` with live merchant credentials on the public HTTPS CRM. Hosted checkout currently supports INR. |
| **Telr** (historical links only) | `TELR_STORE_ID`, `TELR_AUTH_KEY`, `TELR_TEST_MODE` (1 = test) | Optional transaction advice → `/webhooks/telr`. Payment is always confirmed with Telr's *check* API before it is recorded; the scheduler also reconciles open orders |
| **Razorpay** (historical links only) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Webhook `/webhooks/razorpay`, events `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired` |
| **ERPNext** | `ERPNEXT_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `ERPNEXT_COMPANY`, `ERPNEXT_PAID_TO_AED`, `ERPNEXT_PAID_TO_INR` | API user with Accounts User role. Payment Entries are created as **drafts** (set `cfg.integ.erp.submit = true` to post); mode-of-payment names in `cfg.integ.erp.modes`; failed pushes retry from the scheduler |
| **Google Calendar** | `GCAL_SERVICE_ACCOUNT_JSON`, `GCAL_CALENDAR_ID` | Share the calendar with the service account (make changes to events) |
| **E-mail** | none – set in Configuration → Email Outgoing → SMTP server | Google Workspace: smtp.gmail.com, port 465 (SSL), the mailbox address and an app password |

For Gupshup WhatsApp enquiry forms, configure the Flow Journey to POST completed submissions to the CRM. [Gupshup setup and payload](docs/API.md#gupshup-whatsapp-enquiry-form)

## Security model (summary)

Server-side sessions in an HttpOnly `__Host-` cookie with CSRF header, 60-min idle timeout · TOTP two-step verification (required for System Administrator and Management) · PBKDF2 passwords, strength rules, lockout, rate limits · every write re-checked on the server (role, branch, approvals, fees, money, consent) · server-issued record numbers, append-only history and audit · database triggers block overpayment and changes to payments/audit · CSP with script hashes, HSTS, frame denial · signed/verified webhooks · secrets never logged · data retention by the scheduler. Full details: `docs/LOF-CRM-Handover.md`.

### First administrator

```bash
ADMIN_PASSWORD='<temporary password>' node scripts/create-admin.mjs --email admin@yourcompany.com --name "Admin Name" > admin.sql
npx wrangler d1 execute lof_crm --remote --file admin.sql && rm admin.sql
```
The password is stored only as a hash and must be changed at first sign-in.

## Counsellor targets, payment terms, refund rules, LMS

| Setting (Settings →) | What it does | Where it shows |
|---|---|---|
| **Counsellor Targets** | Monthly enrolment, revenue (branch currency, excl. tax) and conversion target per counsellor; copy from the previous month or add the next; compared with each branch target | Counsellor dashboard tile *My monthly target*; report 21 *Counsellor Target vs Achievement*; `GET /api/v1/targets` |
| **Payment Terms** | Instalment plans (split %, days between, minimum first instalment, grace days) and the default | Enrolment form (term + schedule before confirming), Payment Collection, Enrolments list, Reception tile *Overdue instalments*, report 22 *Instalment Status*; scheduler notifies Reception once per overdue instalment |
| **Refund Rules** | Ordered rules by days since enrolment and sessions attended, registration fee, admin fee, tax, approver, calculator | Withdraw form suggests the refund; anything above it is an exception that only the approver role (not the requester) can approve or reject; `GET /api/v1/refunds/suggest` |
| **LMS Integration** | Calls, programme Track/Credit code table, branch code map, field mapping, readiness checklist, sample data | Enrolling sends the enrol call, withdrawing sends the cancel call; Integration Monitor; reports 17–18 |

The schedule, refund suggestion and LMS payload are always computed on the server. **Placeholders to confirm:** refund rule values, and the Track/Credit codes (LOF issues the real list).

## Decisions to confirm with the business

These were open in the prototype; the system implements a sensible default that can be changed:

1. **First payment at enrolment** – roles allowed to enrol (e.g. Centre Administrator) may record the first payment inside the enrolment form, even though the matrix gives them view-only on Payments. Standalone payments still need Payments → Create.
2. **Refund rules** are placeholders (cooling-off 100% ≤ 7 days/2 sessions, 75% ≤ 30/6, 50% ≤ 60/12, 25% ≤ 90/18, admin fee AED 100 / INR 1,500, registration fee retained) until management confirms them.
3. **SLA business hours** are not applied; the clock runs continuously.
4. **INR→AED rate** for reports is a manual setting.
5. **Receipts** acknowledge payment; tax invoices come from ERPNext.
6. **Counsellor-initiated reassignment** goes to the Admissions Head for approval.

## Fixes made to the prototype screens

- Long forms in pop-ups (e.g. *New lead*) grew taller than the window and pushed the Save button off-screen; pop-ups now scroll internally.
- Prototype-only simulators (fake web capture, fake parent replies, fake incoming calls in production) are hidden on real data; the Testing console replaces them.

## Modular frontend and LMS update

The editable screens are in `frontend/`; see `frontend/README.md`. `npm run build:frontend` generates the served files. The existing VPS `scripts/patch-frontend.mjs` command remains supported and runs the same build.

See `docs/LMS-Integration.md` for the November 2026 LMS contract, package mapping, UAT setup and manual verification. Existing SMTP, password reset, report exports and staff/branch access controls are retained.

Local sandbox checkout uses the existing student and displays confirmed test receipts against the original enrolment. The sandbox balance is isolated from production. See [VPS deployment](DEPLOY-VPS.md) for live configuration.
