# LOF CRM – frontend

The CRM screens. Source lives here, split by area. `npm run build:frontend` turns it into the files the Worker
serves from `public/` – do not edit `public/index.html` or `public/assets/` by hand.

```
frontend/
  index.html                 page shell; the build inserts the CSS and script tags
  manifest.json              every source file, in load order (the build and the checks read it)
  styles/                    reset · tokens (colours, light/dark) · base · layout · components · responsive
  src/
    config.js                live (server) or offline demo mode
    core/                    helpers, reference lists, demo seed data, lookups, derived values
    ui/                      runtime (actions, navigation, forms), kit (tables, cards, charts), shell (sidebar, render), events
    domain/                  workflow rules that run in the browser (routing, notifications, audit entries)
    pages/                   one file per area: dashboard, leads/, opportunities, admissions, enrolment wizard,
                             students, payments, discounts & approvals, notifications & audit, reports, settings/
    features/                version 2 features: counsellor targets, payment terms, refunds, LMS
    api/                     server adapter: requests, sign-in, load, sync, record numbers, live integrations,
                             Testing console, Database browser
    boot.js                  starts the offline demo
```

## Commands

| Command                         | What it does                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                   | Build, then run the Worker locally at http://127.0.0.1:8787                                                         |
| `npm run watch:frontend`        | Rebuild whenever a file in `frontend/` changes (run beside `npx wrangler dev`)                                      |
| `npm run build:frontend`        | `public/index.html`, `public/assets/app.<hash>.css/js`, `api.<hash>.js` + source maps, and `dist/lof-crm-demo.html` |
| `npm run check:frontend`        | Every file listed once in the manifest, each file valid on its own, no name declared twice                          |
| `npx prettier --write frontend` | Format (settings in `.prettierrc.json`)                                                                             |

Open `/?demo=1` (or `dist/lof-crm-demo.html`, no server needed) for the offline demo with sample data.

## How the pieces fit

- **Two scripts.** `app.js` is the screens: the `src/` files outside `api/`, joined in manifest order into one
  strict-mode script, so they share top-level names (`S` the state, `PAGES`, `MODALS`, `ACT`, `render()`, `go()` …).
  `api.js` is the server adapter: the `src/api/` files joined inside one closure that only runs when connected
  to the server. It loads the data, sends every change to `PUT /api/v1/sync`, and replaces the demo's simulated
  actions with live ones.
- **Screens are functions that return HTML.** `PAGES.<name>(route)` returns the page, `MODALS.<name>(model)` a
  dialog, and `render()` redraws after each action. Clicks, form submits, changes and typing are routed by
  `data-act`, `data-submit`, `data-change` and `data-input` attributes to `ACT`, `SUB`, `CHG` and `INP`
  handlers (see `ui/events.js`). Always pass user data through `esc()` before putting it in HTML.
- **Order matters.** A file can use anything defined in a file before it in `manifest.json`. Code inside
  functions can use anything, because it only runs after all files have loaded.
- **Production output.** Minified, with file names that change when the content changes (cached for a year),
  and source maps that show the original files in browser dev tools. Nothing is inline, so the
  Content-Security-Policy allows scripts only from the site itself.

## Adding a screen

1. Create `src/pages/<area>.js` with `PAGES.myPage = (rt) => ph('Title', 'Subtitle') + card('…', table(…));`
2. Add it to `manifest.json` (after `ui/` and before `boot.js`).
3. Add it to the sidebar (`GROUPS` in `ui/shell.js`) and to `ACCESS` (which permission it needs).
4. If it saves data, the records go through `PUT /api/v1/sync`, where the server checks the same permission.
   Add the rule to `src/sync/sync.ts` and a test under `test/api/`.
5. `npm run check:frontend && npm test && npm run test:e2e`.

## Next steps (planned)

The split keeps the approved screens exactly as they were (checked screen by screen, pixel for pixel). Two
further steps would make the frontend easier to grow:

- **ES modules.** Give each file explicit `import`/`export` instead of shared top-level names, bundled by
  esbuild. This can be done one area at a time.
- **Fold the server adapter into the screens.** Some `api/` files replace demo functions after load
  (`api/live/*`, `api/qa-fixes.js`). Moving that behaviour into the page files would remove the override
  layer, and the offline demo would then use a mock server instead of its own copy of the rules.
