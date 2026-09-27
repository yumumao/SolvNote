# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, administratively controlled public-registration and user-lifecycle system with Turnstile verification, invitation codes, account expiry, password reset, session revocation, and safe admin APIs.

**Architecture:** Keep registration settings and invitation-code state in SQLite/Prisma instead of treating the JSON app-config file as an authorization database. Add a live-session guard that reads the current user on every protected request, and make JWTs carry a session version only as a fast invalidation hint. Registration creates the user, consumes an invitation, and snapshots initial AI grants in one transaction; the AI grant tables are introduced by the companion AI-access plan.

**Tech Stack:** Next.js App Router route handlers, NextAuth v4 Credentials/JWT, Prisma 5.22 with SQLite, bcryptjs, Zod, React, Vitest, Playwright, Cloudflare Turnstile Siteverify.

**Spec:** `D:\work\github\solvnote\.codex\logs\20260926-user-management-export-auth-draft.md` and `D:\work\github\solvnote\.codex\logs\20260926-user-policy-and-naming.md`.

## Global Constraints

- Do not open public registration, run a production migration, run `prisma generate` in the main worktree, call a real AI provider, or change Zeabur/Cloudflare production settings during implementation.
- Existing administrator accounts start with `expiresAt = null`; no existing account is silently expired or deleted.
- Invitation lifetime is 30 days by default; renewal/extension is an explicit administrator action, and registration-box auto-display is a separate setting. Plaintext invitation codes are returned only at creation or explicit reveal according to the display policy, never included in ordinary list DTOs.
- An expired, disabled, or session-revoked account is rejected by the server before reading or changing private data; hiding a page or button is never an authorization control.
- API responses use explicit allowlisted DTOs and never include `password`, password hashes, session tokens, invite-code plaintext, AI keys, or complete Prisma objects.
- The last usable administrator cannot be disabled, deleted, or demoted; an administrator cannot disable/delete the currently authenticated account.
- Turnstile is verified server-side through Siteverify. A browser token alone is not proof, and a missing secret when verification is enabled fails closed.
- Every write route requires same-origin protection and strict Zod parsing; rate limits and generic error messages must not disclose whether an email exists.
- Tests use an isolated SQLite database and mocked Turnstile/clock/randomness. They do not read production databases, user records, secrets, or question content.

---

### Task 1: Record the policy gate and domain constants

**Files:**
- Create: `docs/adr/0004-user-management-policy.md`
- Create: `src/lib/user-management/policy.ts`
- Test: `src/__tests__/unit/user-management-policy.test.ts`

**Interfaces:**
- Produces `RegistrationPolicy`, `assertRegistrationPolicy()`, `isAccountExpired(user, now)`, and stable error codes used by route handlers.
- Consumes no database or request state; policy constants are safe to use in tests and documentation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { assertRegistrationPolicy, isAccountExpired } from "@/lib/user-management/policy";

describe("user management policy", () => {
  it("requires an explicit decision before enabling public registration", () => {
    expect(() => assertRegistrationPolicy({
      defaultExpirationDays: undefined,
      inviteRequired: undefined,
      inviteMaxUses: undefined,
      inviteLifetimeDays: undefined,
      resetMode: undefined,
    })).toThrow("USER_POLICY_NOT_CONFIRMED");
  });

  it("treats a null expiry as permanent and an equal timestamp as expired", () => {
    const now = new Date("2026-09-27T00:00:00.000Z");
    expect(isAccountExpired({ expiresAt: null }, now)).toBe(false);
    expect(isAccountExpired({ expiresAt: now }, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/unit/user-management-policy.test.ts`
Expected: FAIL because the policy module and exported contracts do not exist.

- [ ] **Step 3: Write the minimal implementation**

Define the policy object with explicit values only after the user accepts them. The confirmed policy values are: new registrations default to a `7`-day trial; an administrator may choose only `7` days, `30` days, or permanent (`null`) for the registration default; users created manually by an administrator are permanent by default; expiry blocks the entire site rather than only AI; an expired account is retained for `30` days and then permanently purged by an idempotent cleanup task; invitation required when the administrator enables it, invitation default one use with a `30`-day lifetime, renewable by an administrator; the admin may choose whether the active registration code is automatically displayed in the registration box; and reset mode `temporary-password-and-force-change`. Existing administrators and existing ordinary users are not silently changed until a separate migration policy is approved. Use UTC `Date` comparisons and fixed public error codes such as `REGISTRATION_DISABLED`, `INVITE_REQUIRED`, `INVITE_INVALID`, `ACCOUNT_EXPIRED`, and `SESSION_REVOKED`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/unit/user-management-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0004-user-management-policy.md src/lib/user-management/policy.ts src/__tests__/unit/user-management-policy.test.ts
git commit -m "docs: define user management policy boundary"
```

### Task 2: Add schema for account lifecycle and invitations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_user_management/migration.sql`
- Create: `src/lib/user-management/dto.ts`
- Test: `src/__tests__/integration/user-management-migration.test.ts`

**Interfaces:**
- `User` adds `expiresAt DateTime?`, `sessionVersion Int @default(0)`, and `mustChangePassword Boolean @default(false)`. Add a cleanup service/command contract that permanently deletes users whose non-null `expiresAt` is at least `30` days in the past; `expiresAt = null` is permanent and is never selected.
- Create `RegistrationSettings` singleton with `id`, `allowRegistration`, `inviteRequired`, `defaultExpirationDays`, `inviteDefaultLifetimeDays` (default `30`), `inviteDisplayEnabled`, `revision`, timestamps.
- Create `InviteCode` with hashed code, `maxUses`, `usedCount`, `expiresAt`, `disabledAt`, creator, timestamps, and a unique hash index. Store only a hash; support explicit administrator renewal/extension and usage metadata, while never returning plaintext in list responses. Never store plaintext codes.
- `dto.ts` exports `publicUserDTO`, `adminUserDTO`, `publicRegistrationStatusDTO`; each uses explicit fields and Date-to-ISO conversion.

- [ ] **Step 1: Write the failing test**

```ts
it("migrates user lifecycle fields and invitation tables without exposing secrets", async () => {
  const db = await isolatedDatabase();
  await applyMigration(db);
  const user = await db.user.create({ data: { email: "u@example.test", password: "hash" } });
  expect(user.sessionVersion).toBe(0);
  expect(user.mustChangePassword).toBe(false);
  expect(user.expiresAt).toBeNull();
  const settings = await db.registrationSettings.findUnique({ where: { id: "site" } });
  expect(settings).not.toBeNull();
  expect("code" in (await db.inviteCode.findFirst() ?? {})).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/integration/user-management-migration.test.ts`
Expected: FAIL because the new Prisma models and migration do not exist.

- [ ] **Step 3: Write the migration and DTOs**

Use an additive migration. Initialize `RegistrationSettings` with registration disabled, no invitation requirement, and `defaultExpirationDays = 7` so deployment does not silently become public while the confirmed trial default is recorded. Enforce the allowlist `7 | 30 | null` at the database/service boundary; reject all other values. Add indexes for `User(expiresAt,isActive)`, `InviteCode(codeHash)`, and `InviteCode(expiresAt,disabledAt)`. The migration must not change existing passwords, roles, data, or expiry values. `publicUserDTO` must omit password/hash and lifecycle internals unless the caller is the administrator viewing the allowlisted status fields.

- [ ] **Step 4: Run migration tests**

Run: `npx vitest run src/__tests__/integration/user-management-migration.test.ts`
Expected: PASS against a temporary database; the main database is not touched.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/user-management/dto.ts src/__tests__/integration/user-management-migration.test.ts
git commit -m "feat: add user lifecycle and invitation schema"
```

### Task 3: Implement live authentication and session revocation

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/ai-access.ts`
- Modify: `src/lib/auth-utils.ts`
- Create: `src/lib/user-management/live-user.ts`
- Test: `src/__tests__/unit/live-user-auth.test.ts`
- Test: `src/__tests__/integration/session-revocation.test.ts`

**Interfaces:**
- `getLiveUserFromRequest(req)` returns an allowlisted current user or throws a fixed auth error.
- `requireActiveUser(req)` checks `isActive`, `expiresAt`, and JWT `sessionVersion` against the database.
- `requireLiveAdmin(req)` additionally checks the current database role, not only a stale JWT role.
- `revokeUserSessions(id)` increments `sessionVersion` atomically.

- [ ] **Step 1: Write failing tests**

```ts
it("rejects a token after an administrator increments sessionVersion", async () => {
  const signedIn = await signInFixture();
  await revokeUserSessions(signedIn.userId);
  await expect(requireActiveUser(signedIn.request)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
});

it("rejects an account at or after expiresAt", async () => {
  await setUser({ isActive: true, expiresAt: new Date("2026-09-27T00:00:00Z") });
  await expect(requireActiveUser(requestAt("2026-09-27T00:00:00Z"))).rejects.toMatchObject({ code: "ACCOUNT_EXPIRED" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/unit/live-user-auth.test.ts src/__tests__/integration/session-revocation.test.ts`
Expected: FAIL because current authorization only trusts `isActive`/JWT fields and has no session version check.

- [ ] **Step 3: Implement the live guard**

Keep NextAuth JWTs for compatibility, but include `sessionVersion` on initial sign-in and compare it with the live row on every protected request. Update `requireUser`/`requireAdmin` consumers that read or write private data to use the live helper. Return a generic 401/403 response without revealing whether the account is disabled, expired, or revoked to anonymous callers. Ensure AI job creation, job polling, conversation actions, export/import, settings, admin users, announcements, error items, and solving records use live authorization.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/unit/live-user-auth.test.ts src/__tests__/integration/session-revocation.test.ts`
Expected: PASS, including stale-role and stale-active-state cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/ai-access.ts src/lib/auth-utils.ts src/lib/user-management src/__tests__/unit/live-user-auth.test.ts src/__tests__/integration/session-revocation.test.ts
git commit -m "feat: enforce live account authorization and session revocation"
```

### Task 4: Add Turnstile verification and transactional registration

**Files:**
- Create: `src/lib/turnstile.ts`
- Modify: `src/app/api/register/route.ts`
- Modify: `src/app/api/register/status/route.ts`
- Create: `src/app/api/register/verify/route.ts` only if the UI needs a server capability endpoint
- Test: `src/__tests__/unit/turnstile.test.ts`
- Test: `src/__tests__/integration/register-security.test.ts`

**Interfaces:**
- `verifyTurnstileToken(token, { remoteIp, expectedAction, expectedHostname })` calls Siteverify with a timeout and returns a boolean-safe result.
- `registerUser(input, requestMeta)` validates settings, Turnstile, invitation, uniqueness, expiry, and initial grant snapshot in one Prisma transaction.

- [ ] **Step 1: Write failing tests**

```ts
it.each(["missing", "expired", "replayed", "wrong-action", "wrong-hostname"])("rejects Turnstile token: %s", async (caseName) => {
  mockSiteverify(caseName);
  const response = await postRegister({ validFields: true, turnstileToken: "token" });
  expect(response.status).toBe(400);
});

it("does not consume an invitation when account creation fails", async () => {
  const before = await inviteUsage();
  await postRegister({ email: existingEmail, inviteCode: validCode });
  expect(await inviteUsage()).toBe(before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/unit/turnstile.test.ts src/__tests__/integration/register-security.test.ts`
Expected: FAIL because registration currently ignores Turnstile/invitations and creates a user outside a lifecycle transaction.

- [ ] **Step 3: Implement verification and registration**

Read `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, optional expected action/hostname from environment. When the administrator enables Turnstile, missing secret or verification failure rejects registration; the server never accepts a client-supplied “verified” boolean. Normalize email before lookup, apply strict name/password limits, return one generic conflict message, and rate-limit repeated failures by IP/email hash. Consume `InviteCode` with an atomic conditional update (`usedCount < maxUses`, not disabled, not expired), then create the user with `expiresAt = null` when the selected default is permanent, otherwise `expiresAt = now + defaultExpirationDays` for the selected `7` or `30` days. The initial AI-grant insertion is called through the interface supplied by the AI-access plan and remains in the same transaction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/unit/turnstile.test.ts src/__tests__/integration/register-security.test.ts`
Expected: PASS for verification failure, replay, invalid invitation, concurrent invite redemption, disabled registration, and successful registration.

- [ ] **Step 5: Commit**

```bash
git add src/lib/turnstile.ts src/app/api/register src/__tests__/unit/turnstile.test.ts src/__tests__/integration/register-security.test.ts
git commit -m "feat: secure registration with Turnstile and invitations"
```

### Task 5: Build administrator settings and invitation management

**Files:**
- Create: `src/app/api/admin/registration/route.ts`
- Create: `src/app/api/admin/invites/route.ts`
- Create: `src/app/api/admin/invites/[id]/route.ts`
- Modify: `src/components/admin/user-management.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/lib/translations.ts`
- Test: `src/__tests__/unit/admin-registration-ui.test.tsx`
- Test: `src/__tests__/integration/admin-registration-api.test.ts`

**Interfaces:**
- `GET/PATCH /api/admin/registration` returns/updates an allowlisted settings DTO with revision CAS.
- `POST /api/admin/invites` returns the newly generated plaintext code exactly once; later GET responses contain only masked code metadata.
- `GET /api/admin/invites` returns usage/expiry/status metadata; `DELETE /api/admin/invites/[id]` disables an unused or active code without deleting audit history.

- [ ] **Step 1: Write failing tests**

```ts
it("returns an invite plaintext only on creation", async () => {
  const created = await postInvite({ maxUses: 1, lifetimeDays: 30 });
  expect(created.body.code).toMatch(/^[A-Z0-9-]+$/);
  const listed = await getInvites();
  expect(JSON.stringify(listed.body)).not.toContain(created.body.code);
});

it("rejects changing settings with a stale revision", async () => {
  const response = await patchRegistration({ revision: 0, allowRegistration: true });
  expect(response.status).toBe(409);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/unit/admin-registration-ui.test.tsx src/__tests__/integration/admin-registration-api.test.ts`
Expected: FAIL because only the legacy `allowRegistration` JSON setting exists.

- [ ] **Step 3: Implement admin APIs and UI**

Add fields for registration toggle, Turnstile enabled indicator (the secret itself is never editable in the site), invitation requirement, default expiry days, and revision. Invitation settings include a default 30-day lifetime, administrator renewal/extension, and a separate `inviteDisplayEnabled` switch: when enabled, the active registration form may show the current usable code; when disabled, the registration form must not reveal it. The code is still hashed at rest and ordinary list responses contain only masked metadata. Expose only the choices `7` days, `30` days, and permanent; reject arbitrary values and prevent enabling registration when Turnstile is enabled but the server secret/site key are unavailable. An administrator-created user action must default to permanent unless an explicit expiry is selected. Provide invite create/revoke/copy-once controls and a warning that the code cannot be recovered. Use live-admin checks and same-origin protection on every mutation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/unit/admin-registration-ui.test.tsx src/__tests__/integration/admin-registration-api.test.ts`
Expected: PASS; also manually confirm no password, hash, secret, or invite plaintext appears in rendered API fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/registration src/app/api/admin/invites src/components/admin/user-management.tsx src/app/admin/page.tsx src/lib/translations.ts src/__tests__/unit/admin-registration-ui.test.tsx src/__tests__/integration/admin-registration-api.test.ts
git commit -m "feat: add registration and invitation administration"
```

### Task 6: Add expiry-aware admin user actions

**Files:**
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/admin/users/[id]/route.ts`
- Create: `src/app/api/admin/users/[id]/reset-password/route.ts`
- Modify: `src/components/admin/user-management.tsx`
- Modify: `src/types/api.ts`
- Create: `src/lib/user-management/purge-expired-users.ts`
- Test: `src/__tests__/integration/admin-user-lifecycle.test.ts`
- Test: `src/__tests__/integration/purge-expired-users.test.ts`
- Test: `src/__tests__/unit/admin-user-lifecycle-ui.test.tsx`

**Interfaces:**
- `PATCH /api/admin/users/[id]` supports active status, role-safe expiry update, and explicit revision.
- `POST /api/admin/users/[id]/reset-password` accepts no password by default, generates a high-entropy temporary password, stores only its bcrypt hash, sets `mustChangePassword`, increments `sessionVersion`, and returns the temporary password once over no-store HTTPS/local test transport.
- `DELETE` performs explicit confirmation at the UI and protects self/last-admin; response is `{ ok: true }` only.

- [ ] **Step 1: Write failing tests**

```ts
it("resets a password and invalidates the old session without returning a hash", async () => {
  const old = await signInAsTarget();
  const result = await resetPassword(targetId);
  expect(result.body.temporaryPassword).toHaveLength(24);
  expect(JSON.stringify(result.body)).not.toMatch(/\$2[aby]\$/);
  await expect(useRequest(old)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
});

it("protects the last usable administrator", async () => {
  const result = await disableOnlyAdmin();
  expect(result.status).toBe(409);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/integration/admin-user-lifecycle.test.ts src/__tests__/unit/admin-user-lifecycle-ui.test.tsx`
Expected: FAIL because current routes return complete Prisma users, do not reset passwords, and only protect a hard-coded super-admin email.

- [ ] **Step 3: Implement lifecycle actions**

Replace complete-object responses with DTOs, use a transaction to count usable administrators before disable/delete/demotion, and increment `sessionVersion` on disable, reset, role change, or expiry change. Keep old learning data cascades only for explicit deletion; never treat expiry as deletion. Add a scheduled/manual idempotent purge operation that selects only users with non-null `expiresAt <= now - 30 days`, deletes the user and all explicitly owned private records in one transaction, and records a count without logging credentials or content. It must be safe to rerun and must never select `expiresAt = null` or accounts expired for fewer than 30 days. Require the administrator to copy the one-time temporary password and show a warning that it cannot be retrieved later. On next login, a `mustChangePassword` account is allowed only to reach the password-change flow; all other protected routes reject it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/integration/admin-user-lifecycle.test.ts src/__tests__/unit/admin-user-lifecycle-ui.test.tsx`
Expected: PASS for reset, expiry extension, permanent/7-day/30-day values, administrator-created permanent users, live disable, live delete, last-admin protection, self-protection, DTO redaction, and the 30-day purge boundary (29 days retained, exactly 30 days purged).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/users src/components/admin/user-management.tsx src/types/api.ts src/__tests__/integration/admin-user-lifecycle.test.ts src/__tests__/unit/admin-user-lifecycle-ui.test.tsx
git commit -m "feat: add safe admin user lifecycle actions"
```

### Task 7: Add forced password-change flow and registration-page UX

**Files:**
- Create: `src/app/api/user/password/route.ts`
- Modify: `src/app/register/page.tsx`
- Modify: `src/app/login/page.tsx`
- Create: `src/components/turnstile-widget.tsx`
- Modify: `src/lib/translations.ts`
- Test: `src/__tests__/unit/registration-ui.test.tsx`
- Test: `e2e/auth-flow.spec.ts`

**Interfaces:**
- `POST /api/user/password` changes the current password, clears `mustChangePassword`, and increments `sessionVersion` after validating the old temporary password/current session.
- Registration status returns only public capability flags and the Turnstile site key, never the secret or invite inventory.

- [ ] **Step 1: Write failing tests**

```ts
it("renders Turnstile only when the public registration status enables it", async () => {
  render(<RegisterPage status={{ allowRegistration: true, turnstileEnabled: true, siteKey: "test" }} />);
  expect(screen.getByTestId("turnstile-widget")).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npx vitest run src/__tests__/unit/registration-ui.test.tsx && npx playwright test e2e/auth-flow.spec.ts --project=chromium`
Expected: FAIL because the registration page has no Turnstile or invite/expiry-aware flow.

- [ ] **Step 3: Implement the UI and forced-change route**

Add a widget that stores the one-use token in component state, clears it after submit/failure, and never writes it to local storage. Show invite input only when required. Handle generic errors without account enumeration. Add a forced password-change screen for a temporary-password session and redirect away from protected pages until completion.

- [ ] **Step 4: Run tests to verify it passes**

Run: `npx vitest run src/__tests__/unit/registration-ui.test.tsx && npx playwright test e2e/auth-flow.spec.ts --project=chromium`
Expected: PASS using official Turnstile test credentials or a fully mocked test server; no real Cloudflare account is used.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/user/password src/app/register src/app/login src/components/turnstile-widget.tsx src/lib/translations.ts src/__tests__/unit/registration-ui.test.tsx e2e/auth-flow.spec.ts
git commit -m "feat: add Turnstile registration and forced password change"
```

### Task 8: Full security regression and deployment gate

**Files:**
- Create: `src/__tests__/integration/user-management-security.test.ts`
- Modify: `e2e/auth-flow.spec.ts`
- Modify: `docs/HTTPS_SETUP.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `.env.example` or the repository's existing environment template

**Interfaces:**
- No new runtime interface; this task verifies all routes use the live guard and documents required environment variables without values.

- [ ] **Step 1: Write failing security tests**

Cover anonymous registration status, disabled registration, invalid/replayed Turnstile, concurrent single-use invite redemption, expired accounts, stale JWT after disable/reset, non-admin admin-route access, last-admin protection, forced password change, DTO redaction, same-origin rejection, and rate-limit behavior.

- [ ] **Step 2: Run the security suite to identify gaps**

Run: `npx vitest run src/__tests__/integration/user-management-security.test.ts`
Expected: Any route that still trusts stale JWT role/state or returns a complete Prisma object is reported as a failure.

- [ ] **Step 3: Fix every reported route and document configuration**

Document placeholder names only: `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_EXPECTED_ACTION`, and optional `TURNSTILE_EXPECTED_HOSTNAME`. Keep registration disabled until an administrator enables it after local testing. State that Cloudflare DNS proxy mode is not part of application registration verification.

- [ ] **Step 4: Run the complete gate**

Run: `npx vitest run src/__tests__/unit src/__tests__/integration`; `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npx playwright test e2e/auth-flow.spec.ts --project=chromium` against an isolated app/database.
Expected: PASS with no secrets, real accounts, production database, or online deployment involved.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__ e2e/auth-flow.spec.ts docs/HTTPS_SETUP.md README.md README.en.md .env.example
git commit -m "test: verify secure public registration lifecycle"
```

## Handoff

The user has confirmed the expiry policy: new registration defaults to a 7-day trial; the administrator may select 7 days, 30 days, or permanent; administrator-created users default to permanent; expiry blocks the entire site; expired users are purged permanently after 30 days. Implement Tasks 1–4 first as the security/data foundation, then Tasks 5–7, and finish with Task 8. Before opening registration, separately record/confirm invitation reuse/lifetime, reset-password mode, existing ordinary-user migration treatment, and the exact cascade/anonymization scope for permanent purge. The AI-access plan must supply the initial-grant transaction interface before registration is opened.
