# Read-only Application Security Review

Scope covered the TanStack/Better Auth web application, worker services, legacy FastAPI proof of concept, AWS/Pulumi infrastructure, dependency manifests, deployment files, and existing tests. The review did not modify application data, call deployed endpoints, inspect external systems, or reveal environment-variable values.

## Confirmed Findings

### F-01 — High — Raw Better Auth Admin APIs Bypass the Super-admin Boundary

**Classification:** Confirmed privilege escalation.

**Affected:** [`webapp/tax-genie/src/lib/auth-server.ts:94`](webapp/tax-genie/src/lib/auth-server.ts#L94), [`webapp/tax-genie/src/routes/api/auth/$.ts:2`](webapp/tax-genie/src/routes/api/auth/$.ts#L2), [`webapp/tax-genie/src/lib/user-roles.ts:1`](webapp/tax-genie/src/lib/user-roles.ts#L1), [`webapp/tax-genie/src/lib/users-module.ts:30`](webapp/tax-genie/src/lib/users-module.ts#L30)

**Evidence:** Both `admin` and `super_admin` receive `create`, `set-role`, `impersonate`, `delete`, `set-password`, and session-management permissions. The `/api/auth/$` catch-all exposes Better Auth’s raw admin endpoints. Its installed handlers permit a caller with `set-role` permission to assign any configured role, including `super_admin`, and its impersonation/password endpoints do not enforce role hierarchy. This bypasses the custom application schemas and guards that intentionally exclude `super_admin` from assignable roles.

**Impact:** An admin can promote itself, create or impersonate a super-admin, reset the super-admin’s password, or alter/delete protected users. This defeats the intended root-account boundary.

**Safe reproduction:** In an isolated test database, authenticate a disposable `admin` and invoke the Better Auth handler for `/api/auth/admin/set-role` against that same test account with role `super_admin`. Roll back the database afterward. Do not use a production account.

**Remediation:** Do not expose Better Auth’s unconstrained admin API to ordinary admins. Make raw plugin administration super-admin-only, or filter/disable dangerous endpoints. Implement role-aware application services for delegated user management, preventing admins from targeting or assigning `super_admin`. Add negative tests for every raw `/api/auth/admin/*` endpoint.

---

### F-02 — Critical — Unauthenticated Replacement of Core Reference Tables

**Classification:** Confirmed vulnerability.

**Affected:** [`webapp/tax-genie/src/routes/api/atc-codes/import.ts:10`](webapp/tax-genie/src/routes/api/atc-codes/import.ts#L10), [`webapp/tax-genie/src/routes/api/entities/import.ts:10`](webapp/tax-genie/src/routes/api/entities/import.ts#L10), [`webapp/tax-genie/src/routes/api/masterlist/import.ts:10`](webapp/tax-genie/src/routes/api/masterlist/import.ts#L10), [`webapp/tax-genie/src/lib/atc-codes-server.ts:152`](webapp/tax-genie/src/lib/atc-codes-server.ts#L152), [`webapp/tax-genie/src/lib/entities-server.ts:147`](webapp/tax-genie/src/lib/entities-server.ts#L147), [`webapp/tax-genie/src/lib/masterlist-server.ts:129`](webapp/tax-genie/src/lib/masterlist-server.ts#L129)

**Evidence:** None of the three handlers resolves a session or checks a role. Each service deletes the entire table inside a transaction before inserting the supplied CSV rows. Existing route tests successfully invoke these handlers without authentication, for example [`webapp/tax-genie/src/routes/api/atc-codes/-import.test.ts:77`](webapp/tax-genie/src/routes/api/atc-codes/-import.test.ts#L77).

**Impact:** Any network caller can replace tax-code, entity, and masterlist data. This can corrupt calculations, redirect business communications, expose or destroy master data, and halt processing.

**Safe reproduction:** Invoke each exported handler in a unit test with a mocked import service and a request containing no cookies or authorization headers. Verify that the service is called and a `201` response is returned. Do not call a deployed endpoint.

**Remediation:** Require at least admin—preferably super-admin—authorization before parsing the body. Centralize this guard, add audit events, preserve transactional validation, and add explicit unauthenticated/editor rejection tests.

---

### F-03 — High — Unbounded Unauthenticated Multipart and Synchronous CSV Parsing

**Classification:** Confirmed code gap; practical impact depends on upstream body limits.

**Affected:** The three import routes above; [`webapp/tax-genie/src/lib/atc-codes-server.ts:170`](webapp/tax-genie/src/lib/atc-codes-server.ts#L170), [`webapp/tax-genie/src/lib/entities-server.ts:165`](webapp/tax-genie/src/lib/entities-server.ts#L165), [`webapp/tax-genie/src/lib/masterlist-server.ts:148`](webapp/tax-genie/src/lib/masterlist-server.ts#L148)

**Evidence:** The handlers call `request.formData()` before authentication. Services then call `file.text()` and synchronously parse the entire CSV. No content-length, file-size, row-count, column-count, or cell-length limit is enforced in application code.

**Impact:** An unauthenticated request can consume substantial memory and block the Node event loop, potentially denying service.

**Safe reproduction:** In a local test harness, configure a small intended limit and submit a fixture just over that threshold to demonstrate that the current handler lacks a rejection path. Avoid genuinely large payloads.

**Remediation:** Authenticate before body parsing; enforce gateway and application body limits; reject oversized `Content-Length`/`File.size`; stream CSV parsing; and cap rows, columns, and cell lengths.

---

### F-04 — High — Generic S3 Proxy Bypasses Object-level and Export Authorization

**Classification:** Confirmed access-control bypass.

**Affected:** [`webapp/tax-genie/src/routes/api/s3-object.ts:58`](webapp/tax-genie/src/routes/api/s3-object.ts#L58), [`webapp/tax-genie/src/lib/access-control.ts:149`](webapp/tax-genie/src/lib/access-control.ts#L149), [`webapp/tax-genie/src/lib/intake-server.ts:358`](webapp/tax-genie/src/lib/intake-server.ts#L358), [`webapp/tax-genie/src/routes/api/uploads/batches.$batchId.files.ts:20`](webapp/tax-genie/src/routes/api/uploads/batches.$batchId.files.ts#L20), [`webapp/tax-genie/src/routes/api/documents.$docId.original-file.ts:25`](webapp/tax-genie/src/routes/api/documents.$docId.original-file.ts#L25)

**Evidence:** `/api/s3-object` accepts an arbitrary `key` and optional allowed bucket. It checks only whether the session has upload access—which includes editors—and whether the bucket is globally allowed. It does not bind the key to an authorized database record, owner, tenant, object type, or PDF-export permission. Batch API responses expose storage and artifact keys. The dedicated original-file endpoint, in contrast, checks `canExport.pdf`.

**Impact:** An editor without export permission can retrieve any known object in an allowed bucket, potentially including original tax documents, generated results, signatures, and reports.

**Safe reproduction:** Mock an editor session with `canExportPdf=false`, mock S3 with a harmless fixture belonging to another test user, and verify `/api/s3-object?key=...` returns it while the dedicated original-file route rejects the same user.

**Remediation:** Remove the generic proxy. Accept an opaque document/artifact identifier, resolve the storage location server-side, and enforce role, export permission, tenant, ownership, and object-type checks. Avoid returning raw storage keys to clients.

---

### F-05 — High — Editors Can Mutate Other Users’ Upload Batches

**Classification:** Confirmed horizontal authorization bypass.

**Affected:** [`webapp/tax-genie/src/routes/api/uploads/complete.ts:18`](webapp/tax-genie/src/routes/api/uploads/complete.ts#L18), [`webapp/tax-genie/src/routes/api/uploads/batches.$batchId.ts:59`](webapp/tax-genie/src/routes/api/uploads/batches.$batchId.ts#L59), [`webapp/tax-genie/src/routes/api/uploads/batches.$batchId.restore.ts:22`](webapp/tax-genie/src/routes/api/uploads/batches.$batchId.restore.ts#L22), [`webapp/tax-genie/src/lib/intake-server.ts:2132`](webapp/tax-genie/src/lib/intake-server.ts#L2132), [`webapp/tax-genie/src/lib/intake-server.ts:2175`](webapp/tax-genie/src/lib/intake-server.ts#L2175), [`webapp/tax-genie/src/lib/intake-server.ts:2373`](webapp/tax-genie/src/lib/intake-server.ts#L2373)

**Evidence:**

- Rename omits `userId`; the service checks ownership only when the optional value is supplied.
- Delete uses the caller ID only as `deletedByUserId`, not as an authorization predicate.
- Restore accepts `userId` but never compares it with `createdByUserId`.
- Completion/queueing looks up any upload UUID without checking the caller or batch owner.
- Neighboring reopen logic explicitly checks `createdByUserId`, confirming ownership is part of the intended model.

**Impact:** Any editor can rename, delete, restore, or queue another editor’s uploads, causing integrity loss, service disruption, or unwanted processing cost.

**Safe reproduction:** With a mocked database or disposable local records for users A and B, invoke each handler as B using A’s batch/upload ID and verify the mutation proceeds. Roll back all fixture data.

**Remediation:** Make actor identity mandatory in all service calls. Perform conditional database updates requiring `createdByUserId=actorId`, with an explicit admin override if intended. Return consistent `403`/`404` responses and test every owner/non-owner/role combination.

---

### F-06 — Medium — Forced Password Change Is Enforced Only by Page Navigation

**Classification:** Confirmed control bypass.

**Affected:** [`webapp/tax-genie/src/routes/__root.tsx:23`](webapp/tax-genie/src/routes/__root.tsx#L23), [`webapp/tax-genie/src/lib/user-admin-server.ts:38`](webapp/tax-genie/src/lib/user-admin-server.ts#L38), [`webapp/tax-genie/src/routes/api/users/create.ts:66`](webapp/tax-genie/src/routes/api/users/create.ts#L66), [`webapp/tax-genie/src/routes/api/users/reset-password.ts:73`](webapp/tax-genie/src/routes/api/users/reset-password.ts#L73), [`webapp/tax-genie/src/routes/api/uploads/presign.ts:15`](webapp/tax-genie/src/routes/api/uploads/presign.ts#L15)

**Evidence:** New/reset accounts receive `mustChangePassword=true`, but `__root.tsx` declares every `/api/*` path public to its page-navigation guard. `resolveContextFromRequest` returns the user context without rejecting the flag.

**Impact:** A holder of an initial or administratively reset password can use normal application APIs without completing the required password change.

**Safe reproduction:** Mock a valid editor session with `mustChangePassword=true` and call a harmless API with invalid body data. Reaching application validation instead of a forced-change rejection demonstrates the bypass.

**Remediation:** Add a centralized server-side session policy that allows only password change, logout, and minimal session endpoints while the flag is set. Prefer a restricted activation session rather than a full application session.

---

### F-07 — High — Password Changes and Administrative Resets Do Not Revoke Existing Sessions

**Classification:** Confirmed session-management vulnerability.

**Affected:** [`webapp/tax-genie/src/routes/api/users/change-password.ts:64`](webapp/tax-genie/src/routes/api/users/change-password.ts#L64), [`webapp/tax-genie/src/routes/api/users/reset-password.ts:73`](webapp/tax-genie/src/routes/api/users/reset-password.ts#L73), [`webapp/tax-genie/src/lib/auth-server.ts:242`](webapp/tax-genie/src/lib/auth-server.ts#L242), [`pnpm-lock.yaml:227`](pnpm-lock.yaml#L227)

**Evidence:** Self-service password change does not request `revokeOtherSessions`. Administrative `setUserPassword` updates only the credential; the pinned Better Auth implementation does not delete sessions. The application enables a seven-day session cookie cache. Account banning does revoke sessions, so the issue is specifically password change/reset.

**Impact:** A stolen session remains usable after the victim or an administrator changes the password, undermining account-recovery response.

**Safe reproduction:** Open two local sessions for a disposable test account. Change or reset the password in session A, then call `/api/access-context` or another read-only endpoint using session B. Session B should currently remain valid.

**Remediation:** On administrative reset, revoke all target-user sessions. On self-service change, revoke other sessions and rotate the current session. Add tests for both workflows and require reauthentication for high-risk changes.

---

### F-08 — High — Legacy Extraction API Is Unauthenticated and Exposes Expensive Document Processing

**Classification:** Confirmed code vulnerability; external reachability is deployment-dependent.

**Affected:** [`v1_poc/app/api/routes/extraction.py:11`](v1_poc/app/api/routes/extraction.py#L11), [`v1_poc/app/services/document_service.py:60`](v1_poc/app/services/document_service.py#L60), [`v1_poc/app/main.py:16`](v1_poc/app/main.py#L16), [`v1_poc/fly.toml:11`](v1_poc/fly.toml#L11)

**Evidence:** `/extraction/bir2307` has no authentication or rate limit, trusts a client-controlled MIME type, reads the complete upload, and allows `force_recompute=true`. It then invokes Azure Document Intelligence, PDF conversion, and OpenAI once per request/page. `fly.toml` defines a public HTTPS service if this POC is deployed. Actual current deployment status was not checked.

**Impact:** If reachable, unauthenticated callers can trigger cloud costs, memory/CPU exhaustion, and high-page-count fan-out. Internal exception strings are also returned.

**Safe reproduction:** Instantiate FastAPI’s test client with a stub `DocumentService`, upload a tiny PDF-like fixture without credentials, and verify the service is invoked—including with `force_recompute=true`.

**Remediation:** Retire or network-isolate the POC. Otherwise require strong authentication, remove or restrict `force_recompute`, enforce byte/page/time quotas, validate PDF signatures and structure, add per-principal rate/cost limits, and return generic errors.

---

### F-09 — Resolved — Self-hosted Langfuse Public Cleartext Exposure

**Classification:** Historical infrastructure finding; resolved by removing the self-hosted stack.

**Affected:** The removed Langfuse EC2, EIP, security group, and local Docker stack.

**Evidence:** The former deployment opened TCP 3000 to `0.0.0.0/0`, assigned a public Elastic IP, and returned plain HTTP URLs. Those resources and configuration paths no longer exist.

**Impact:** The former deployment could expose telemetry, prompts, tax-document traces, credentials, and session cookies to Internet scanning, brute force, and on-path interception.

**Verification:** Run an IaC preview and confirm there is no Langfuse instance, Elastic IP, TCP 3000 ingress, or Langfuse stack output.

**Remediation implemented:** TaxGenie now sends selectively redacted, best-effort traces to LangSmith Cloud's APAC endpoint. The legacy trace storage is intentionally destroyed without migration.

---

### F-10 — High — Reachable Production Dependencies Have Known Vulnerabilities

**Classification:** Confirmed vulnerable versions; application exploitability remains partially potential.

**Affected:** [`webapp/tax-genie/package.json:43`](webapp/tax-genie/package.json#L43), [`pnpm-lock.yaml:227`](pnpm-lock.yaml#L227), [`webapp/tax-genie/src/lib/reconciliation-server.ts:343`](webapp/tax-genie/src/lib/reconciliation-server.ts#L343)

**Evidence:** `pnpm audit --prod` reported 5 critical, 75 high, 112 moderate, and 14 low vulnerability instances. Most are build-tool or unused-plugin paths, but these runtime paths are relevant:

- `xlsx` 0.18.5 directly parses uploaded workbooks before the application’s row limit. Audit reported prototype-pollution and ReDoS advisories [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).
- Better Auth 1.4.1 has applicable path/rate-limit bypass advisories, including [GHSA-x732-6j76-qmhm](https://github.com/advisories/GHSA-x732-6j76-qmhm) and [GHSA-p6v2-xcpg-h6xw](https://github.com/advisories/GHSA-p6v2-xcpg-h6xw).
- The legacy Python lock produced 57 audit entries across 11 packages. Multipart-parser DoS advisories are relevant to its unauthenticated upload, but the Dockerfile ignores `uv.lock`, so the exact deployed versions are indeterminate.

**Impact:** Malicious authenticated workbook uploads may trigger parser denial of service or state corruption; authentication rate limits may be bypassed; legacy multipart processing may be exhausted.

**Safe reproduction:** Verify lock-to-advisory mappings and execute ordinary small fixture files to establish that the vulnerable parsers are reached. Do not use published exploit payloads against a live service.

**Remediation:** Upgrade Better Auth to a currently patched release and regression-test the admin plugin. Replace npm `xlsx` with a maintained parser—ExcelJS is already present—or isolate parsing in a constrained worker. Make Python builds reproducible using the lock and upgrade affected packages.

---

### F-11 — Medium — Database Clients Disable TLS Certificate Verification

**Classification:** Confirmed vulnerability.

**Affected:** [`webapp/tax-genie/src/lib/db.ts:26`](webapp/tax-genie/src/lib/db.ts#L26), [`backend/worker/src/db/client.ts:13`](backend/worker/src/db/client.ts#L13), [`backend/merge-worker/src/app.ts:60`](backend/merge-worker/src/app.ts#L60), [`backend/infra/lambda/db-migrate.ts:29`](backend/infra/lambda/db-migrate.ts#L29), [`backend/infra/lambda/batch-retention.ts:593`](backend/infra/lambda/batch-retention.ts#L593)

**Evidence:** Remote clients remove `sslmode` and `sslrootcert`, then set `rejectUnauthorized:false`.

**Impact:** Traffic is encrypted but the database server’s identity is not authenticated. A network-position or DNS/control-plane attacker could intercept database credentials and tax data.

**Safe reproduction:** Mock `pg.Pool` and inspect its constructed configuration; verify remote URLs produce `rejectUnauthorized:false`.

**Remediation:** Use the AWS RDS CA bundle with `rejectUnauthorized:true`, preserve validated SSL parameters, and fail closed on certificate errors.

---

### F-12 — Medium — Long-lived Secrets Are Embedded in EC2 User Data and Process Arguments

**Classification:** Confirmed insecure secret-distribution pattern.

**Affected:** [`backend/infra/compute-worker.ts`](backend/infra/compute-worker.ts)

**Evidence:** Database credentials, admin tokens, telemetry secrets, OCR keys, and initialization passwords are interpolated into EC2 user data, `.env` files, and Docker command-line environment arguments. Instances do not explicitly require IMDSv2. The worker instance role can read and write the entire storage bucket.

**Impact:** IAM principals that can read instance user data, host administrators, process inspection, support bundles, or a compromised container may obtain long-lived secrets or broad S3 credentials.

**Safe reproduction:** Unit-test the generated template using placeholder markers and assert that secret variable names appear in user data; never print actual values.

**Remediation:** Store secrets in Secrets Manager/SSM Parameter Store and fetch them at runtime with narrowly scoped IAM. Use credential files/tmpfs where practical, require IMDSv2, restrict metadata access from containers, narrow S3 permissions to required prefixes/actions, and rotate existing credentials after migration.

---

### F-13 — Medium — Secondary Upload Paths Lack Structural and Resource Validation

**Classification:** Potential risk; no exploit was executed.

**Affected:** [`webapp/tax-genie/src/lib/intake-utils.ts:41`](webapp/tax-genie/src/lib/intake-utils.ts#L41), [`webapp/tax-genie/src/lib/intake-server.ts:2425`](webapp/tax-genie/src/lib/intake-server.ts#L2425), [`backend/worker/src/langgraph/utils/pageProcessing.ts:40`](backend/worker/src/langgraph/utils/pageProcessing.ts#L40), [`webapp/tax-genie/src/lib/signing-module.ts:86`](webapp/tax-genie/src/lib/signing-module.ts#L86), [`webapp/tax-genie/src/lib/signing-server.ts:290`](webapp/tax-genie/src/lib/signing-server.ts#L290)

**Evidence:** Main PDF validation trusts filename/MIME metadata and has no page-count cap before splitting every page. Signature profile data URLs, text fields, and claimed dimensions have no explicit maximum or decoded-image verification.

**Impact:** Authenticated users may submit complex/high-page PDFs or oversized signature payloads that increase memory, CPU, storage, and OCR costs.

**Safe reproduction:** Locally generate a small PDF containing more pages than the intended business maximum and observe that every page is split. Separately, use `signatureProfileUpsertSchema.safeParse` with placeholder values exceeding a proposed policy and observe that no maximum rejects them.

**Remediation:** Validate PDF magic bytes and parser structure, cap page count and decompressed complexity, sandbox converters, and enforce decoded signature-byte, pixel-dimension, and text-length limits.

---

### F-14 — Medium — S3 Security Controls Rely on Account Defaults

**Classification:** Potential infrastructure risk.

**Affected:** [`backend/infra/data.ts:250`](backend/infra/data.ts#L250)

**Evidence:** The bucket enables versioning but does not explicitly define Public Access Block, ownership controls, server-side encryption/KMS, or a TLS-only bucket policy. CORS allows any origin for `PUT` and `HEAD`. AWS account defaults may currently compensate, but that is not enforced by this stack.

**Impact:** Account-level drift or future changes could expose sensitive tax documents or weaken encryption and browser-origin restrictions.

**Safe reproduction:** Use an IaC preview or policy test to verify these resources/policies are absent. Do not alter the deployed bucket.

**Remediation:** Explicitly enable all four Public Access Block settings, bucket-owner-enforced ownership, encryption—preferably KMS—and a deny-non-TLS policy. Restrict CORS to the application’s production origins.

---

### F-15 — Medium — Proxy-controlled Headers Influence Trusted Origins and Audit Identity

**Classification:** Potential, conditional on reverse-proxy header sanitation.

**Affected:** [`webapp/tax-genie/src/lib/auth-server.ts:71`](webapp/tax-genie/src/lib/auth-server.ts#L71), [`webapp/tax-genie/src/lib/audit.ts:92`](webapp/tax-genie/src/lib/audit.ts#L92)

**Evidence:** Better Auth trusted origins are expanded from request URL, `X-Forwarded-Host`, protocol, and `Host`. Audit IP resolution trusts the first `X-Forwarded-For`, then client-facing IP headers, and incorrectly accepts `X-Forwarded-Host` as an IP address.

**Impact:** If the edge does not overwrite these headers, origin protections and forensic audit records may be spoofed. The `X-Forwarded-Host` fallback is invalid audit data regardless.

**Safe reproduction:** In a unit test, construct a request with `X-Forwarded-Host: example.invalid` and `X-Forwarded-For: audit-marker`; verify those values influence trusted-origin/audit resolution without sending external traffic.

**Remediation:** Use only a configured origin allowlist. Define trusted proxy hops and select the verified client-IP position supplied by the platform. Never treat host headers as IP addresses.

---

### F-16 — Low — Raw Backend Errors Are Returned to Clients

**Classification:** Confirmed information disclosure.

**Affected:** [`webapp/tax-genie/src/routes/api/s3-object.ts:136`](webapp/tax-genie/src/routes/api/s3-object.ts#L136), [`v1_poc/app/api/routes/extraction.py:57`](v1_poc/app/api/routes/extraction.py#L57), [`backend/worker/src/app.ts:83`](backend/worker/src/app.ts#L83)

**Evidence:** AWS SDK errors, document-processing exception strings, and database readiness errors are serialized into responses.

**Impact:** Responses can reveal bucket/key details, SDK behavior, upstream errors, database state, or internal paths useful for follow-on attacks.

**Safe reproduction:** Mock a backend dependency to throw a unique non-secret marker and verify the marker appears in the response.

**Remediation:** Return stable public error codes/messages, log full details server-side with a correlation ID, and keep readiness diagnostics generic.

## False Positives and Compensating Controls

- No tracked real `.env`, private key, cloud access-key pattern, or API-key pattern was found in the current tree or filename history. Only example/sample environment files are tracked; `.env` files are ignored by [`.gitignore:17`](.gitignore#L17). This was a pattern-based check, not a guarantee equivalent to a dedicated historical secret scanner.
- No confirmed SQL injection was found. Database access predominantly uses Drizzle parameterization. The development reset’s `sql.raw` statement is constructed from a fixed table list and is environment/admin gated.
- No confirmed shell injection was found. PDF utilities are generally invoked through argument-array APIs such as `execFile`, and merge output names are generated server-side.
- Better Auth audit advisories requiring two-factor, OAuth-provider, OIDC, MCP, or organization plugins were not treated as applicable because those plugins are not enabled.
- `canEditValidatedCertificateFields` omits `super_admin`; this appears to deny an intended privilege rather than escalate one.
- Positive controls include disabled public signup, email verification, a strong 12-character password policy, main PDF size limits, sales-report size/row limits, stage-gated development reset, S3 bucket allowlisting, and bearer protection on worker admin endpoints.

## Validation Performed

- Existing frontend test suite: **102 files / 795 tests passed**. Vitest reported a teardown warning, but the tests completed successfully.
- The successful import-route tests corroborate that those handlers currently execute without an authentication context.
- `pnpm audit --prod --json` and an exported-lock `pip-audit` were triaged for reachable runtime paths rather than accepting their raw severity labels.
- No source or application data files were changed during the review.

## Executive Summary

The repository has one immediately critical unauthenticated data-integrity issue and several high-impact authorization failures. The most urgent remaining risks are the unauthenticated table-replacement endpoints, raw Better Auth admin APIs that defeat the super-admin hierarchy, the generic S3 object proxy, and cross-user batch mutations. The public cleartext Langfuse finding was resolved by removing the self-hosted stack.

Authentication configuration has useful baseline controls, but forced-password-change and password-reset session handling can be bypassed. Upload size controls exist on primary workflows, yet structural validation and secondary upload limits remain incomplete. No committed secret values or confirmed SQL/command injection were found.

## Prioritized Remediation Plan

1. **Immediate / P0**

   - Disable or super-admin-protect all three CSV import endpoints and add strict body limits.
   - Restrict Better Auth raw admin endpoints to `super_admin`; add role-hierarchy tests.
   - Remove or redesign `/api/s3-object` around authorized database identifiers.
   - Add owner predicates to rename, delete, restore, and complete/queue operations.

2. **Within 7 days / P1**

   - Enforce `mustChangePassword` centrally on APIs.
   - Revoke/rotate sessions after password change and administrative reset.
   - Retire or authenticate and quota the legacy FastAPI service.
   - Upgrade Better Auth and replace or isolate the vulnerable `xlsx` parser.
   - Enable verified PostgreSQL TLS using the RDS CA bundle.

3. **Within 30 days / P2**

   - Move EC2 secrets to Secrets Manager/SSM, require IMDSv2, and narrow IAM.
   - Add PDF magic, page-count, complexity, and signature-image limits.
   - Codify S3 Public Access Block, encryption, TLS-only access, ownership, and restricted CORS.
   - Configure trusted origins and proxy IP handling explicitly.
   - Standardize generic external errors and correlation-ID logging.
   - Add a security regression matrix covering unauthenticated, viewer, editor, admin, super-admin, owner, and non-owner cases.
