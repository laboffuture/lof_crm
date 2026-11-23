# LOF CRM to LMS integration

This implementation follows the client-supplied LOF CRM to LMS Integration Guide v1.1 dated 2 November 2026. It supersedes the September JSON/Bearer examples. Existing students, enrolments, payments, branches and programme masters do not need to be replaced. No database migration or seed import is required.

## Implementation and reason

| Change                                                                                                            | Why                                                                                                       | Guide                                |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| POST form encoding; server-only `wstoken`, Moodle function name and JSON response format                          | The LMS does not accept JSON request bodies or the former enrol/cancel envelope                           | 2, 4                                 |
| Indexed `items` and `skillslabs`, with an explicit outbound field allowlist                                       | Sends exact purchased Credits or Skills Lab session counts; excludes prices, payment methods and invoices | 3, 4, 7                              |
| Catalogue and student lookup functions                                                                            | Uses documented connectivity/code validation and student-link checks                                      | 6, 8                                 |
| Full-payment trigger on new orders, for counter and gateway payments                                              | An enrolment alone is not a paid order; the first instalment does not activate access                     | 1, 7                                 |
| One permanent enrolment reference and student ID per order                                                        | Preserves idempotency and student identity; siblings need separate orders                                 | 3, 7                                 |
| Package-level access mappings, with multiple Track and Skills Lab lines supported by the API                      | Different packages must not automatically receive an entire programme's Credit list                       | 3                                    |
| Student email remains distinct from the parent; date/phone/code validation                                        | Prevents misidentification and malformed requests without rewriting customer profiles                     | 3, 7                                 |
| HTTP 200 error handling, persistent warning status and `purchaseknown` review                                     | Receiving an HTTP response is not proof that access was granted                                           | 5, 6                                 |
| Frozen payload before the first network attempt; atomic delivery claim; bounded retries and interruption recovery | A timeout may occur after LMS received the order; retries must carry the same reference and contents      | 5, 7                                 |
| Business-order setup failures stay Awaiting Setup in every runtime environment                                    | Real orders must not be marked delivered through mock mode                                                | 2, 8                                 |
| November contract marker on newly created enrolments/calls                                                        | Prevents historical enrolments from being automatically backfilled or resent                              | User's data-preservation requirement |

Success in the monitor means LMS acknowledged receipt. It does not claim that LOF staff have processed the order or that the student has logged in and verified access. Business orders in development, UAT, staging and production stay Awaiting Setup when LMS is disabled, credentials are absent or mock mode is selected. Only explicit Testing Console records and automated tests may simulate delivery; missing setup cannot produce a mock Success for a business order.

## Configuration without replacing existing data

Keep the ignored `.dev.vars` file private. `.dev.vars.example` supplies development defaults and the UAT endpoint; its token is intentionally blank. The existing `.dev.vars` file is not changed by this implementation. Production credentials belong in Cloudflare server secrets.

With `INTEGRATION_MODE=mock`, tests and local development use simulated providers. To test the real UAT connection, configure `LMS_URL` and `LMS_TOKEN` on the backend, set integration mode to `auto`, and enable LMS in settings. Keep UAT and live credentials and mappings in their respective environments.

`npm run check:lms` makes only the catalogue request from the calling machine. It reads server environment variables or `.dev.vars`, prints no token or provider response body, and never purchases/cancels an order. A local successful request does not prove the deployed backend's outbound IP is allowlisted. Repeat the connection test from the intended deployment.

Map exact entitlements under `cfg.lms.packages[programmeId][packageName]`. A single-Track mapping has `{ track, credits, skillslabs }`; a multiple-Track mapping may use `{ items: [{ track, credits, product_name }], skillslabs: [...] }`. Skills Lab lines contain `{ program, sessions }` and optional `valid_until` and `product_name`. The settings form edits one Track and one Skills Lab per package and preserves multi-line API mappings. Legacy programme mappings remain readable in previews/mock mode but are insufficient to authorize a first live purchase. Live delivery requires an explicit package mapping and confirmed codes.

Use `cfg.lms.branchMap` to map existing branch IDs to the client-approved LMS codes; do not rename or overwrite branch masters. Business mappings require LOF approval. The supplied UAT CSVs list Falcon `FT` (`F2`, `FC1`–`FC4`), Tesla `RT` (`C1`, `C2`) and Andheri West `AW`. Automated tests use these as isolated fixtures. The user also authorized the temporary local UAT mapping recorded below while business mappings are unavailable; it must not be treated as a production mapping or evidence of LOF approval.

## Local UAT delivery verified 13 November 2026

The user requested real UAT delivery using the supplied document examples and the existing CRM products and branches. Local `.dev.vars` now uses `INTEGRATION_MODE=auto` with the existing UAT URL and token preserved. LMS sending is enabled. The temporary local mapping is `KRM → AW` and `ROB / Term (24 sessions) → FT, [FC1, FC2]`. Other branch mappings were cleared of placeholder codes so they cannot accidentally send that package to an unverified centre. Existing branch and product masters were preserved. The previous LMS settings are backed up in the ignored `backups` directory. The settings confirmation flag enables this user-authorized UAT trial; it is not LOF business approval.

The catalogue call succeeded from the running local CRM backend. A new registration using the guide's fictional Riya Sharma / Amit Sharma details, with a local counter-payment record explicitly referenced `UAT-DOC-TEST-NO-MONEY-20261113`, triggered a real form-encoded purchase to the UAT endpoint. No money was collected. CRM student `LOF-26-000009`, order `EN-26-0012`, call `MS-089` received `{"accepted":true,"duplicate":false,"inboxid":1,"warnings":[]}`. Its saved delivery mode is `live`, and the student LMS tab displays Success. Only this new order was sent; historical mock deliveries were not replayed.

This verifies local CRM-to-UAT purchase delivery. It does not establish that the example email already has an LMS login, that LOF processed the order, or that the student sees Credits. Those require LOF verification before cancelling this order. Duplicate, invalid-Credit and cancellation UAT cases remain pending. No deployed server or production configuration was changed. The code change that prevents business-order mock successes passed TypeScript checking and all 263 automated tests.

## Payment and order lifecycle

New enrolments are marked with `lmsContract: "2026-11-v1.1"`; a server-owned purchase record starts Awaiting Payment. Full payment moves it to Pending, whether collected in the enrolment form, later at the counter, or through a gateway. The cron recovers interrupted new-contract work. Existing enrolments without this marker are not automatically submitted when a later payment arrives. There is no historical backfill script.

Before the first network attempt, validation checks identity and entitlements and the complete purchase payload is stored on the sync record. Timeouts, 5xx responses and malformed acknowledgements keep that snapshot. Only Moodle's explicit `invalidparameter` rejection allows rebuilding corrected data, because the guide says it was not received. Accepted orders with warnings cannot be edited or blindly retried: LOF must confirm their correction/reprocessing procedure.

Queue workers atomically claim only Pending calls. A duplicate queue message cannot immediately retry a Failed call, bypass the configured retry interval, or submit a Retry Required call after automatic attempts are exhausted. The scheduler requeues eligible failures after the configured delay. A deliberate staff retry may make an additional attempt beyond the automatic limit and still uses the original frozen request.

Withdrawal sends a whole-order cancel using the same reference. It does not introduce partial LMS cancellation or new refund rules. Partial monetary-refund policy and first-instalment access remain business decisions; the implementation follows the guide's paid-order trigger until a different rule is explicitly approved.

## Verification and UAT

Run `npm run typecheck`, `npm run check:frontend`, `npm test` and `npm run build:frontend`. Do not run `build:seed` or apply migrations to an existing database as part of this integration change. Automated tests create fresh in-memory SQLite databases and use stubbed providers; they do not modify `.wrangler` or remote D1.

The v1.1 suite covers exact form encoding, multiple Tracks and Skills Labs, omission of financial fields, secret redaction, catalogue and lookup, HTTP 200 errors, accepted warnings, duplicate acknowledgement, frozen retries, malformed responses, cancellation references, production setup failures, concurrent delivery, payment activation, historical-record isolation, interruption recovery and identity/entitlement validation.

Joint UAT remains required: catalogue from the intended server; purchase for an existing LMS test student; duplicate reference; invalid Credit warning; LOF staff processing and student-visible Credits; cancellation with `purchaseknown:true`. Real UAT delivery is not proven by mocks.

Client inputs still required: approved programme/package and branch mappings; existing UAT student account and separate parent email; Skills Lab codes when available; confirmation of instalment/refund policy and warning resolution; live URL/token/code lists after UAT. The developer must establish and provide the actual backend outbound IP for the client's allowlist.

## Registration duplicate checks

New-student registration treats matching parent contact details as informational: a different child can continue on the first click. A matching student email, or matching full name and DOB, still prompts staff to review the existing student before creating another profile. The acknowledgement and typed draft survive a form redraw; choosing Use existing student reuses that child's permanent student ID.

## Request and response logs

LMS browser console diagnostics have been removed. The durable Integration log in Settings → Testing console retains the redacted HTTP request, destination URL and provider response. The LMS call history and saved receipt remain available, and opening those records never resends an order.
