---
version: alpha
colors:
  primary: '#2d5b9a'
  background: '#f3f5f9'
  panel: '#ffffff'
  foreground: '#1b2633'
  accent: '#2d5b9a'
  sidebar: '#13243b'
  warning: '#9a6c17'
  danger: '#a2403c'
typography:
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
  data:
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace'
omitted:
  - section: spacing
    reason: 'Established layout and component CSS remain canonical; this integration change adds no spacing tokens.'
  - section: rounded
    reason: 'Established component CSS remains canonical; no geometry change is requested.'
  - section: components
    reason: 'Existing JavaScript UI kit owns components; no new component system is introduced.'
---

# LOF CRM design context

## Overview

An English-language operations workspace for counsellors, reception and branch administrators in India and the UAE. Preserve the existing dense CRM interface: navy navigation, cool grey workspace, white panels and restrained status colours. The signature is the stable navigation shell and compact business tables. This task changes LMS behavior and explanatory text, not visual identity.

## Colors

`frontend/styles/tokens.css` is the runtime source of truth. The frontmatter records its current light-theme roles. Dark theme overrides live in the same stylesheet. Success, warning and error meaning must also appear in text, including LMS warnings and waiting states.

## Typography

Use the existing IBM Plex Sans body face and IBM Plex Mono identifiers. Fonts and fallbacks are owned by `--f-body` and `--f-mono`; do not add external font dependencies.

## Layout

Reuse `frontend/src/ui/kit.js` cards and paginated tables, `ui/runtime.js` fields and dialogs, and the configuration screen structure. Long package mappings retain horizontal table scrolling on narrow screens. Preserve page and modal scroll ownership.

## Components

The LMS monitor uses the same status badges, notifications, history dialog and pagination as adjacent administrative screens. Native select and date controls retain the existing platform-owned behavior. Backend authorization remains authoritative. See `UX-CONTRACT.md` for ownership and delivery states.

## Do's and Don'ts

Explain what staff must correct in visible text. Distinguish receipt from applied student access and mock delivery from real delivery. Never display tokens. Do not introduce a redesign or invent product-to-LMS mappings.

Repository extensions: retain the Learning Based CRM sign-in, password reset, report exports, email settings/automation, branch access and archive/delete screens. Their adapter modules are listed in `frontend/manifest.json`.
