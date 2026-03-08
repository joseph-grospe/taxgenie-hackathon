# Admin User Account Settings Page

## Purpose

Document the admin-only account settings page in the TaxTrack webapp as a product and implementation specification.

This page is the operational control surface for user administration. It allows an admin to:

- view all managed users
- create new users with an initial password
- update a user's team, role, and export permissions
- reset a user's password
- deactivate or reactivate a user
- review the role access matrix

## Primary Users

### Admin

Needs to:

- provision accounts without public signup
- assign the correct role and team
- control export permissions
- reset or revoke access safely
- understand what each role can do

### Managed user

Interacts with this page indirectly through admin actions.

The main downstream dependency is the first-login password change flow after:

- new account creation
- password reset

## Goals

- Keep user administration in one clear operational page.
- Enforce admin-only access both in the UI and server handlers.
- Make user creation and password reset reliable for non-technical admins.
- Preserve a forced-password-change flow for temporary credentials.
- Reflect the current TaxTrack role model without exposing role CRUD.

## Non-Goals

- Personal profile settings for non-admin users.
- Organization management or multi-tenant membership.
- Fine-grained custom permissions editor.
- Hard delete of user accounts.
- Full audit exploration inside the settings page itself.

## Route

- Route: `/settings`
- Source: [settings.tsx](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/settings.tsx)

## Access Control

- Only authenticated users with role `admin` can manage this page.
- Non-admin users see an unauthorized state instead of the management UI.
- The page relies on the parsed session context from:
  - [access-control.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/access-control.ts)
  - [auth-client.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/auth-client.ts)

## Page Layout

The page has two primary columns.

### Left column

- `Users` heading
- feedback and error messages
- users table

### Right column

- `Role access matrix`
- `User administration` summary panel

The page uses the existing app shell and shadcn-based primitives.

## Functional Requirements

### FR-1 Access restriction

- The route must only allow admins to manage users.
- Non-admin users must not be able to mutate user-management endpoints even if they call APIs directly.

### FR-2 User listing

- The page must show the current set of managed users.
- The list must include role, team, export permissions, and active/deactivated state.

### FR-3 User creation

- Admin must be able to create a user with email, name, temporary password, role, team, and export permissions.
- Password policy must be enforced before submit and at the API boundary.
- A created user must be marked for forced password change on first login.

### FR-4 User update

- Admin must be able to update role, team, and export permissions.
- Admin role must retain full export access.

### FR-5 Password reset

- Admin must be able to assign a new temporary password to an existing user.
- Reset users must be required to change their password after sign-in.

### FR-6 Deactivate/reactivate

- Admin must be able to deactivate and reactivate users without deleting records.

### FR-7 Role visibility

- The page must explain effective role access in a read-only matrix.

### FR-8 Error visibility

- Validation failures must be visible in the current interaction context.
- Server-side failures must surface useful, human-readable messages.

### FR-9 First-login completion

- A user with `mustChangePassword=true` must be redirected to the password change flow after sign-in.
- After a successful password change, the flag must clear and the user must proceed to the intended route.
- If the route transition fails after a successful password update, the UI must offer a recovery action instead of asking the user to submit the password form again.

## Main Table

The users table shows:

- user name
- email
- role
- team
- status
- PDF export permission
- Excel export permission
- row actions

### Status values

- `Active`
- `Deactivated`

### Table actions

Each user row exposes:

- `Edit user`
- `Reset password`
- `Activate` or `Deactivate`

## User Management Flows

### 1. Create user

Triggered from the page action button: `Create user`.

The create sheet includes:

- email
- name
- temporary password
- role
- team
- allow PDF export
- allow Excel export

Behavior:

- validates input with `userCreateSchema`
- enforces the shared password policy
- submits to `/api/users/create`
- closes the sheet and reloads users on success

Notes:

- the created password is temporary
- the user is expected to change it after first sign-in

### 2. Edit user

Triggered from the row pencil action.

The edit sheet includes:

- role
- team
- allow PDF export
- allow Excel export

Behavior:

- validates input with `userUpdateSchema`
- submits to `/api/users/update`
- reloads the user list on success

### 3. Reset password

Triggered from the row lock action.

The reset password sheet includes:

- new temporary password

Behavior:

- validates input with `userResetPasswordSchema`
- enforces the same password policy
- submits to `/api/users/reset-password`
- marks the account for a forced password change in the backend flow

### 4. Deactivate or reactivate user

Triggered from the status action button in the row.

Behavior:

- deactivate calls `/api/users/deactivate`
- reactivate calls `/api/users/reactivate`
- deactivate requires confirmation in the browser
- list refreshes after the action completes

## First-Login Password Change Flow

This page depends on a working first-login password change flow.

Expected sequence:

1. admin creates a user or resets that user's password
2. backend stores a temporary credential and sets `mustChangePassword=true`
3. user signs in with the temporary credential
4. app redirects the user to `/change-password`
5. user submits current temporary password and a new compliant password
6. backend changes the credential and clears `mustChangePassword`
7. app fetches a fresh session and routes the user to the intended page

Implementation references:

- [change-password.tsx](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/change-password.tsx)
- [change-password.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/change-password.ts)

## Role Access Matrix

The page includes a read-only access matrix for:

- `admin`
- `editor`
- `viewer`

The matrix summarizes access for:

- settings
- upload
- reports
- audit

The matrix data comes from:

- [access-control.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/access-control.ts)

## Validation and Error Handling

The page currently uses schema validation before submit and shows inline message text inside each sheet.

### Validation sources

- [users-module.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/users-module.ts)
- `userCreateSchema`
- `userUpdateSchema`
- `userResetPasswordSchema`
- `passwordPolicy`

### Current feedback behavior

- load failures appear above the table
- action success messages appear as short-lived feedback above the table
- sheet form errors appear inside the sheet content

## Acceptance Criteria

### User listing

- Admin opening `/settings` sees the managed-users table.
- Non-admin opening `/settings` does not see user-management controls.

### User creation

- Admin can create `admin`, `editor`, or `viewer` users.
- Invalid password input is rejected with a clear policy message.
- Created user appears in the table after refresh.
- Created user is forced into the first-login password change flow.

### User update

- Admin can change role, team, and export flags.
- Updated values appear in the table after save.

### Password reset

- Admin can set a new temporary password for an existing user.
- Reset user is required to change the password on next sign-in.

### Deactivate/reactivate

- Deactivated user shows `Deactivated` state.
- Reactivated user shows `Active` state.

### First-login password change

- User can sign in with the temporary password.
- User can change password using the temporary password as the current password.
- User is not trapped in `/change-password` after a successful change.
- Old temporary password no longer works after success.
- New password works on subsequent sign-in.
- If post-success navigation fails, the page offers `Retry continue` or `Sign in again`.

## Edge Cases

- Admin attempts to deactivate their own account.
- Admin creates a user with an email that already exists.
- Admin assigns `admin` role and export toggles are inconsistent with admin defaults.
- Temporary password already matches the new password.
- New password fails complexity rules.
- Password confirmation does not match.
- Password change succeeds but session data is stale.
- User retries password change after the first attempt already changed the credential.
- User session expires while a sheet form is open.
- User list request fails while the page shell still loads.

## Security and Audit Expectations

- Every mutating admin action must remain protected server-side.
- Create, update, reset, deactivate, reactivate, and password-change flows must continue to emit audit events.
- The page must not expose direct password values after submit.
- Public signup remains disabled.

## Backend API Dependencies

The page depends on these endpoints:

- [list.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/list.ts)
- [create.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/create.ts)
- [update.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/update.ts)
- [reset-password.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/reset-password.ts)
- [deactivate.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/deactivate.ts)
- [reactivate.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/reactivate.ts)

All endpoints require an admin context on the server side.

## Related Flows Outside `/settings`

This page works together with the first-login password change flow.

Related route:

- [change-password.tsx](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/change-password.tsx)

Related API:

- [change-password.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/routes/api/users/change-password.ts)

The intended lifecycle is:

1. admin creates a user or resets a password
2. user signs in with the temporary password
3. user is required to set a new password
4. account continues with normal access

## Data Model Used by the Page

The page uses the managed-user model with these fields:

- `id`
- `name`
- `email`
- `role`
- `team`
- `canExportPdf`
- `canExportExcel`
- `isBanned`

Supporting definitions come from:

- [user-roles.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/user-roles.ts)
- [users-module.ts](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/webapp/tax-track/src/lib/users-module.ts)

## Current UX Notes

- The page is admin-focused and operational rather than profile-focused.
- The page currently uses right-side sheets for create, edit, and reset flows.
- Password policy guidance is shown inline in the relevant forms.
- Success feedback is brief and auto-dismissed.

## Suggested Future Enhancements

- use toast notifications for errors that are easy to miss inside sheets
- add explicit empty-state guidance when there are no managed users
- add search and role/team filters for larger user lists
- add audit event shortcuts from the user row
- add self-profile settings separately from admin user management so `/settings` does not mix personal profile changes with admin operations
