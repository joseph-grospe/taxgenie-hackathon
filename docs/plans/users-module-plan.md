# Plan: Admin User Access Module for `@webapp` (`/settings`)

## Summary

Build a production-ready access-management module inside existing `/settings` for TaxTrack with:

- Admin-managed user provisioning (email + temporary password).
- Three core roles (`admin`, `editor`, `viewer`) with server-enforced RBAC.
- Forced password change on first login and after every admin reset.
- Per-user export overrides via admin checkboxes (`PDF`, `Excel`) at create/edit time.
- Full access/auth audit events for this module.
- Public `/signup` disabled.

This plan uses the current auth stack (`better-auth`) and upgrades it from memory to Postgres-backed persistence.

## Scope (Phase 1)

- In scope: users, roles, permissions enforcement, temp-password flow, export overrides, audit logging, `/settings` UX, route/action guards.
- Out of scope: true row-level data filtering (RLS). We only prepare schema/hooks for future RLS.
- Out of scope: ATC/retention CRUD changes (keep existing sections read-only).

## Existing Code Areas to Extend

- [auth-server.ts](../../webapp/tax-track/src/lib/auth-server.ts)
- [auth-client.ts](../../webapp/tax-track/src/lib/auth-client.ts)
- [\_\_root.tsx](../../webapp/tax-track/src/routes/__root.tsx)
- [settings.tsx](../../webapp/tax-track/src/routes/settings.tsx)
- [login.tsx](../../webapp/tax-track/src/routes/login.tsx)
- [signup.tsx](../../webapp/tax-track/src/routes/signup.tsx)
- [app-sidebar.tsx](../../webapp/tax-track/src/components/app-sidebar.tsx)
- [webapp infra env injection](../../backend/infra/webapp.ts)

## Architecture and Data Model

### 1) Auth persistence and plugins

Use `better-auth` with:

- Postgres adapter (replace memory adapter).
- `admin` plugin for admin APIs (`createUser`, `listUsers`, `setRole`, `setUserPassword`, `ban/unban`, etc.).
- user additional fields:
  - `team` (controlled enum)
  - `mustChangePassword` (boolean)
  - `canExportPdf` (boolean)
  - `canExportExcel` (boolean)

Keep bootstrap seed admin env vars (`TAXTRACK_SEED_*`) for first-run bootstrap only.

### 2) Role model

Fixed roles:

- `admin`
- `editor`
- `viewer`

No role CRUD in phase 1. Role assignment is managed by Admins only.

### 3) Team model (for future RLS)

Single-org model with structured team enum:

- `tax_manager`
- `project_lead`
- `tax_team`
- `ar_team`
- `it`
- `bacon`
- `other`

RLS not enforced yet; team is stored now for future policy implementation.

### 4) Deactivation model

“Remove user” maps to deactivate/reactivate:

- Deactivate via admin action (ban/unban or equivalent enforced disabled state).
- No hard delete in phase 1.

### 5) Audit table

Add `security_audit_logs` table:

- `id`, `occurredAt`, `eventType`, `actorUserId`, `targetUserId`, `metadata`, `ipAddress`, `userAgent`.
  Capture:
- `user_created`
- `user_updated`
- `user_deactivated`
- `user_reactivated`
- `user_password_reset`
- `user_role_changed`
- `user_export_override_changed`
- `password_changed_first_login`
- `password_changed_self`
- `login_failed` (from login flow handler)
- `login_succeeded` (on session creation hook)

## Permission Model

### Effective permissions

- Role defaults provide base permissions.
- Export permissions are per-user overrides only:
  - `canExportPdf`
  - `canExportExcel`
- Admin role always has full export permission and cannot be restricted by override UI.

### Route/action enforcement (existing app features only)

- `/settings`: `admin` only.
- `/upload`: `admin`, `editor`.
- `/dashboard`, `/batch-status`, `/issues`, `/validated`, `/reconciliation`, `/reports`, `/audit`, detail pages: all authenticated roles.
- Report export actions: gated by per-user export flags.
- All guards must be enforced both:
  - at route level (`beforeLoad` for UX)
  - in server mutation/read actions (authoritative enforcement)

### Future permission stubs (stored in config/constants, not wired yet)

- Data source access controls.
- Share dashboard.
- Schedule reports.

## UX and Flow Plan

### `/settings` (Admin-only)

Sections:

1. `Users` table: name, email, team, role, export PDF, export Excel, status, actions.
2. `Create user` dialog: email, name, team, role, temporary password, export toggles.
3. `Edit user` dialog: team, role, export toggles.
4. `Reset password` dialog: admin enters new temporary password.
5. `Deactivate/Reactivate` confirmation dialogs.
6. `Role access matrix` read-only panel reflecting your provided access model.

Design constraints:

- Minimal, functional UI.
- No decorative gradients.
- Use existing shadcn components (table, dialog/sheet, form fields, badge, alert dialog).

### Forced password change

- Add `/change-password` route.
- If `mustChangePassword=true`, block all protected routes and redirect to `/change-password`.
- After successful change:
  - set `mustChangePassword=false`
  - continue to originally requested route.

### Disable public signup

- `/signup` no longer allows account creation.
- Route should redirect to `/login` (or 404), and signup affordances remain removed.

## Important Public API / Interface / Type Changes

### Session/user shape additions

Augment user/session typing to include:

- `role: 'admin' | 'editor' | 'viewer'`
- `team: Team`
- `mustChangePassword: boolean`
- `canExportPdf: boolean`
- `canExportExcel: boolean`

### New server-side module contracts

Add typed server actions (or typed route handlers) for:

- `getAccessContext()`
- `listManagedUsers()`
- `createManagedUser(input)`
- `updateManagedUser(input)`
- `deactivateManagedUser(input)`
- `reactivateManagedUser(input)`
- `resetManagedUserPassword(input)`
- `changeOwnPassword(input)`

All mutation inputs validated with Zod and strong password policy.

### Environment / config additions

- Webapp runtime requires `DATABASE_URL`.
- Keep `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TAXTRACK_SEED_*`.
- Infra update in web deployment to inject `DATABASE_URL` for web runtime.

## Implementation Sequence (Decision-Complete)

1. Add webapp DB layer and dependencies (`pg`, `drizzle-orm`, `drizzle-kit`) and migration scripts.
2. Replace memory adapter in auth server with Postgres-backed adapter.
3. Enable admin plugin, role config, and additional user fields.
4. Add audit table + write helper and hook points.
5. Create access-control constants and permission resolver (role defaults + export overrides).
6. Build server actions/handlers for user lifecycle and password flows.
7. Add `/change-password` route and hard-block logic in root guard.
8. Lock `/settings` to Admin and apply permission guards to relevant routes/actions.
9. Rebuild `/settings` with user management UI and export checkboxes (create/edit).
10. Disable `/signup` route behavior.
11. Show/hide nav items by permission for better UX (non-authoritative).
12. Wire audit event reads into `/audit` (at least for access/auth events).
13. Update env samples and infra env injection docs.

## Test Cases and Scenarios

1. **Auth bootstrap**

- Seed admin created once; repeated startup does not duplicate.

2. **User creation**

- Admin can create `editor`/`viewer`/`admin`.
- Strong password validation enforced.
- Export overrides persist correctly.
- Audit event written.

3. **First login forced password**

- New user login redirects to `/change-password`.
- User cannot access protected pages before changing password.
- Success clears `mustChangePassword` and allows normal access.
- Audit event written.

4. **Reset password**

- Admin reset sets `mustChangePassword=true`.
- Next login forces change.
- Audit event written.

5. **Role and route enforcement**

- `viewer` denied `/settings` and `/upload`.
- `editor` denied `/settings`, allowed `/upload`.
- `admin` allowed all.
- Server actions reject unauthorized role even if called directly.

6. **Export override enforcement**

- User with `canExportPdf=false/canExportExcel=false` cannot perform exports.
- Enabling checkbox grants only chosen format(s).
- Changes are auditable.

7. **Deactivation/reactivation**

- Deactivated user cannot sign in/use active session.
- Reactivated user can sign in again.
- Both actions audited.

8. **Signup disabled**

- `/signup` is inaccessible for public account creation.

9. **Regression**

- Existing login/session flow remains functional.
- Existing pages still render for authorized users.

## Assumptions and Defaults Chosen

- Single-organization model.
- `admin` can assign `admin` role.
- Access model uses fixed roles, with only export as per-user override.
- Export override is two separate toggles (PDF and Excel), editable on create and later edit.
- ATC/retention edits are deferred.
- True RLS is deferred; team data is captured now for future RLS implementation.
