# Application Page Plans — Project TaxTrack (BIR 2307)

This document translates the user journey into concrete page-level plans. It focuses on functionality, interactions,
user expectations, and UI/UX behavior for each page.

## Planning Snapshot

- Grounded in: `docs/ARCHITECTURE.md`, `docs/USER_JOURNEY.md`, `docs/original_requirement/requirement.md`, `docs/PROJECT_SUMMARY.MD`.
- Goal: define each page, what the user does there, and how the UI should behave.
- Scope: web app experience for BIR 2307 processing (upload, status, validation, reconciliation, reporting, audit).

## Global UX Principles

- Always show processing status and time-to-complete expectations.
- Make errors explicit and actionable with reasons and next steps.
- Keep data lineage visible: original file, extracted fields, validation rules, reconciliation results.
- Use progressive disclosure: show summary first, drill down on demand.
- Favor batch operations and bulk actions (documents are processed in volume).
- Track all user actions via audit logs.
- Keep raw data read-only; manual correction is out of scope, but override notes may be recorded.

## Navigation Map (User Journey → Pages)

- Login → Dashboard → 2307 Module Landing → Upload Batch → Batch Status
- Batch Status → Duplicates & Errors → Error Detail → Validated Results
- Validated Results → Reconciliation → Reports & Export → Audit Trail

---

## Page: Login

**Purpose**
- Authenticate users and route them to their organization dashboard.

**Primary Users**
- Admin, Reviewer, Ops

**Layout / UI**
- Simple sign-in form, password reset, and SSO (if enabled).

**Information Architecture (Wireframe)**
- Brand + environment indicator, centered auth card, helper links.
- Minimal distractions; focus on primary action.

**Component Inventory**
- Logo/brand lockup, email/password fields, primary button.
- "Forgot password" link, SSO buttons (optional), error banner.

**Core Actions**
- Sign in, reset password.

**States**
- Loading, invalid credentials, locked account.

**UX Expectations**
- Clear error messaging, no friction beyond required controls.

**Audit / Analytics**
- Login success/failure, device, location (if enabled).

---

## Page: Dashboard (Home)

**Purpose**
- Provide at-a-glance status of recent batches, errors, and reports.

**Key Data**
- Recent batches, processing status, errors count, duplicate count.
- Quick links: upload batch, view errors, create report, audit log.

**Layout / UI**
- Top summary cards, recent batches table, alert list.

**Information Architecture (Wireframe)**
- Global nav and org switcher, summary KPIs, recent activity, alerts.
- Primary CTA row for upload/report actions.

**Component Inventory**
- KPI cards, batch table, status pills, progress bars.
- Alerts panel, quick action buttons, filters/search.

**Core Actions**
- Start new upload, resume a batch, open errors, export report.

**States**
- Empty state for first-time users (CTA to upload).
- Partial processing state with progress bars.

**UX Expectations**
- Should feel like a command center; no deep data editing here.

**Audit / Analytics**
- Dashboard visit, CTA clicks, batch navigation.

---

## Page: 2307 Module Landing

**Purpose**
- Introduce the 2307 workflow and provide standards (format, naming rules).

**Key Data**
- File requirements, naming convention, status legend, SLA/processing time.

**Layout / UI**
- Checklist of requirements, example file name, link to upload.

**Information Architecture (Wireframe)**
- Intro + objective, requirements checklist, naming example, status legend.
- CTA panel to start upload or open existing batches.

**Component Inventory**
- Checklist items, code-style filename block, legend chips, CTA button.

**Core Actions**
- Proceed to batch upload, view existing batches.

**States**
- Informational only; no heavy data.

**UX Expectations**
- Sets expectations and reduces invalid uploads.

---

## Page: Upload Batch

**Purpose**
- Upload a set of BIR 2307 PDFs and create a batch.

**Key Data**
- Batch name, period, upload files list, validation summary.

**Layout / UI**
- Drag-and-drop area, file list, validation panel, submit button.

**Information Architecture (Wireframe)**
- Batch metadata header (name, period), upload zone, file list, validation summary.
- Footer action bar with primary "Start Processing".

**Component Inventory**
- Drag-and-drop uploader, file rows with status, inline validation badges.
- Batch metadata form, progress indicators, remove file action.

**Core Actions**
- Upload files, remove file, start processing.

**States**
- Pre-upload, uploading, validation errors (unsupported format).

**UX Expectations**
- Fast feedback on file type and size.
- Provide guidance for naming but do not block if naming is off (renaming is automated later).

**Audit / Analytics**
- Batch created, file count, total size.

---

## Page: Batch Status (Processing View)

**Purpose**
- Track batch progress and drill into individual documents.

**Key Data**
- Status timeline: queued → OCR → LLM → validation → done/failed.
- Per-document status, timestamps, confidence, error codes.

**Layout / UI**
- Batch summary header, progress timeline, document table.

**Information Architecture (Wireframe)**
- Batch header with summary stats, stage timeline, filters, document grid.
- Optional side drawer for quick document preview.

**Component Inventory**
- Status timeline, table with row actions, filter chips, live update badge.
- Pagination, bulk selection, mini preview drawer.

**Core Actions**
- Filter by status, open document detail, re-run (if enabled).

**States**
- Live updates via sync engine; partial completion states.

**UX Expectations**
- Transparent processing stages and ETA indicators.
- Errors should be linked to remediation view.

**Audit / Analytics**
- Batch view, filter use, doc drill-downs.

---

## Page: Duplicates & Errors (Queue)

**Purpose**
- Provide a consolidated list of duplicates and validation failures.

**Key Data**
- Duplicate reason (TIN + period + issuer + reference).
- Error categories (missing fields, variance > PHP 100, invalid ATC, etc.).

**Layout / UI**
- Tabs or filters: Duplicates, Errors, All.
- Table with reason tags and severity.

**Information Architecture (Wireframe)**
- Tabs for issue type, summary counts, filter bar, issues table.
- Emphasize prioritization and review flow.

**Component Inventory**
- Tab switcher, severity chips, reason tags, bulk actions.
- Export button, issue table with status badges.

**Core Actions**
- Open detail, download raw file, mark reviewed.

**States**
- No issues state (success messaging).

**UX Expectations**
- Prioritize errors by severity and volume.

**Audit / Analytics**
- Error review started, error resolved (if applicable).

---

## Page: Error Detail (Document Review)

**Purpose**
- Inspect a single problematic document with context.

**Key Data**
- PDF viewer, extracted fields, confidence scores.
- Validation failures with precise rules.

**Layout / UI**
- Split view: document viewer + extracted fields panel.
- Error checklist with flags.

**Information Architecture (Wireframe)**
- Top action bar, left PDF viewer, right data panel with validation summary.
- Notes area for review rationale.

**Component Inventory**
- PDF viewer, field list with confidence meters, rule checklist.
- Notes textarea, download button, error summary banner.

**Core Actions**
- Download raw file, export error details, add review notes.

**States**
- OCR/LLM incomplete, missing pages, corrupted file.

**UX Expectations**
- User can quickly understand why the document failed.
- Manual correction is out of scope, but review notes should be captured.

**Audit / Analytics**
- Error detail view, notes added, file downloaded.

---

## Page: Validated Results (Documents)

**Purpose**
- Show successful extractions and their normalized data.

**Key Data**
- Extracted fields, confidence, file name (renamed format), status.

**Layout / UI**
- Table with bulk download/export options.
- Optional quick preview panel.

**Information Architecture (Wireframe)**
- Filter/search bar, results table, bulk actions.
- Optional right-side preview for selected doc.

**Component Inventory**
- Search input, filters (period, status), table with selection.
- Bulk export/download buttons, preview panel.

**Core Actions**
- Export JSON/CSV, download renamed PDFs, filter by period.

**States**
- Empty state if no validated docs.

**UX Expectations**
- Fast search/filter, bulk operations are primary.

**Audit / Analytics**
- Export actions, document download count.

---

## Page: Reconciliation

**Purpose**
- Match extracted 2307 data with prepaid CWT records.

**Key Data**
- Revenue upload file, match rate, unmatched records, variance totals.

**Layout / UI**
- Upload area for revenue data, reconciliation table, summary stats.

**Information Architecture (Wireframe)**
- Revenue upload panel, reconciliation status summary, match table.
- Unmatched/variance panel for exceptions.

**Component Inventory**
- File upload, run reconciliation button, match rate cards.
- Reconciliation table, variance highlights, export controls.

**Core Actions**
- Upload revenue data, run reconciliation, export reconciliation sheet.

**States**
- Waiting for revenue upload, processing, partial match.

**UX Expectations**
- Clear mapping between extracted data and revenue records.

**Audit / Analytics**
- Reconciliation run, match rate, export triggered.

---

## Page: Reports & Export

**Purpose**
- Generate and download monthly or quarterly outputs.

**Key Data**
- Period selector, report type, status, download links.

**Layout / UI**
- Report builder with period filters and output formats.

**Information Architecture (Wireframe)**
- Report builder controls, generation status, report history list.
- Download area with versioned outputs.

**Component Inventory**
- Period picker, report type select, format toggles.
- Generate button, report history table, download links.

**Core Actions**
- Generate report, download/export.

**States**
- Report generation in progress, report ready.

**UX Expectations**
- Reports should be reproducible and clearly labeled.

**Audit / Analytics**
- Report generated, download count.

---

## Page: Audit Trail

**Purpose**
- Provide an immutable log of system and user actions.

**Key Data**
- Event type, user, timestamp, object (batch/doc/report), action.

**Layout / UI**
- Log table with filters and search.

**Information Architecture (Wireframe)**
- Filter bar (date, user, object), audit log table, detail drawer.

**Component Inventory**
- Search input, date range picker, filter chips.
- Log table with expandable rows, export button.

**Core Actions**
- Filter by date, user, object type.

**States**
- Large volume paging, export logs.

**UX Expectations**
- Audit logs must be easy to export for compliance review.

**Audit / Analytics**
- Audit log exports, filter usage.

---

## Optional Page: Admin Settings

**Purpose**
- Manage org settings, users, roles, and reference data.

**Key Data**
- Users, roles, ATC code table, retention policies, file naming rules.

**Layout / UI**
- Settings sections with safe defaults and confirmations.

**Information Architecture (Wireframe)**
- Settings sidebar, main panel with sectioned forms/tables.
- Clear save and rollback actions per section.

**Component Inventory**
- Users table, role badges, ATC code editor, retention toggles.
- Confirmation dialogs, change log summary.

**Core Actions**
- Add/remove users, update ATC rates, set retention.

**States**
- Permission denied, validation errors.

**UX Expectations**
- Admin-only, careful confirmation before changes.

**Audit / Analytics**
- Settings changes, role updates.

---

## Open Questions / To Confirm

- What roles and permissions are required beyond admin/reviewer/ops?
- Should document review allow a manual override or annotation workflow?
- What are the exact report formats (CSV/Excel/PDF) and templates?
- Do we need any intake option beyond in-app manual uploads?
- How should retry/reprocess be exposed in the UI?
