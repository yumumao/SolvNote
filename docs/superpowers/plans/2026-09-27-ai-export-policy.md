# AI configuration export policy and import template Implementation Plan

> 2026-09-27 publication update: implemented in an isolated worktree; the user confirmed real local verification and authorized GitHub publication. Source publication does not authorize a production migration, image release, or Zeabur restart. Both login and registration require Turnstile; registration and AI export remain opt-in policies. See `docs/user-management.md` for current deployment variables and single-canonical-domain requirements. Historical checkboxes below are not deployment acceptance evidence.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Keep AI configuration import and editing available while disabling configuration export by default, with export possible only when the deployment explicitly enables one environment variable.

**Architecture:** Put one fail-closed environment gate in a server-only helper and make both the export route and UI consume it. Keep the existing encrypted import/preview/edit flow, add a redacted JSON template with no credentials, and scope future private-user configuration writes to the owning account.

**Tech Stack:** Next.js App Router route handlers, Node runtime, existing `sealExport`, `loadAIConfig`, portable v1 schema, Zod, React, and Vitest.

**Spec:** `D:\work\github\solvnote\.codex\接续入口.md`顶部确认：导出默认关闭，仅环境变量明确开启才允许；保留导入和编辑；普通登录不增加邮箱验证码，也不复用ScanDex邮箱码。

## Global Constraints

- The exact server-only variable is `SOLVNOTE_ENABLE_AI_CONFIG_EXPORT`; only trimmed case-insensitive `true` enables it. Missing, empty, malformed and other values are disabled.
- Disabled export returns stable generic `AI_CONFIG_EXPORT_DISABLED` and must not load configuration, seal data or serialize credentials.
- Import, preview and edit keep live authorization, strict schema validation, same-origin protection, bounded requests, revision CAS, redacted responses and no plaintext credentials.
- The template has synthetic HTTPS examples and empty `apiKey` fields only; no real key, account, database path, deployment secret or question content.
- No Cloudflare email code is added to ordinary login or import. Do not enable export in local preview, public demo, Zeabur or production during implementation.

---

### Task 1: Add the fail-closed server-only policy helper

**Files:** create `src/lib/ai-config/export-policy.ts`, `src/__tests__/unit/ai-config/export-policy.test.ts`, `docs/adr/0005-ai-config-export-policy.md`.

**Interface:** `isAiConfigExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean`; `assertAiConfigExportEnabled(env?: NodeJS.ProcessEnv): void` throws `AI_CONFIG_EXPORT_DISABLED`.

- [ ] **Step 1:** Write tests for undefined, empty, `false`, `1`, `yes`, and whitespace/case variants; only trimmed case-insensitive `true` passes.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/unit/ai-config/export-policy.test.ts`; expect failure because the helper is absent.
- [ ] **Step 3:** Implement the helper with `String(value ?? "").trim().toLowerCase() === "true"`; keep all environment access server-only. In the ADR record that this blocks accidental export but deliberate enablement still requires credential rotation/incident response if a key leaks.
- [ ] **Step 4:** Run the same test; expect PASS.
- [ ] **Step 5:** Commit with `git add src/lib/ai-config/export-policy.ts src/__tests__/unit/ai-config/export-policy.test.ts docs/adr/0005-ai-config-export-policy.md && git commit -m "feat: add fail-closed AI export policy"`.

### Task 2: Gate the route and hide export UI by default

**Files:** modify `src/app/api/ai/config/export/route.ts`, `src/components/ai-config-export.tsx`, and the administrator AI settings component that renders it; create `src/__tests__/unit/ai-config/export-route.test.ts`; modify `src/__tests__/unit/ai-export-origin-ui.test.tsx`.

**Interfaces:** Disabled `POST /api/ai/config/export` returns `{message:"AI_CONFIG_EXPORT_DISABLED"}` with a non-success status and no-store headers. Enabled behavior preserves live admin auth, same-origin, password/revision validation, encrypted envelope projection and no-store headers. Client receives only a server-derived `{exportEnabled:boolean}` capability, never an environment variable.

- [ ] **Step 1:** Write failing tests proving disabled export does not call `loadAIConfig` or `sealExport`, enabled export preserves the encrypted envelope, client/body/header flags cannot enable it, and import/edit remain available.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/unit/ai-config/export-route.test.ts src/__tests__/unit/ai-export-origin-ui.test.tsx`; expect failure because current export is always allowed.
- [ ] **Step 3:** Call `assertAiConfigExportEnabled()` before loading/sealing. Provide the capability from server code or an authenticated capability endpoint with no secret/config payload. Hide only the export action; keep import, preview, edit and template visible.
- [ ] **Step 4:** Run focused tests; expect PASS for disabled default, explicit enablement, admin/origin denial, conflict, redaction and envelope validation.
- [ ] **Step 5:** Commit with `git add src/app/api/ai/config/export src/components/ai-config-export.tsx src/__tests__/unit/ai-config/export-route.test.ts src/__tests__/unit/ai-export-origin-ui.test.tsx && git commit -m "feat: disable AI configuration export by default"`.

### Task 3: Provide a credential-free import format template

**Files:** create `docs/templates/solvnote-ai-config.template.json`, `src/app/api/ai/config/template/route.ts`, and `src/__tests__/unit/ai-config/template.test.ts`; modify the AI settings/import component, `src/lib/translations.ts`, and `src/__tests__/unit/ai-settings-editor.test.tsx`.

**Interface:** `GET /api/ai/config/template` returns a static bounded portable-v1 template with attachment headers, `Cache-Control: public, max-age=3600`, and no secrets. It validates against `ConfigSchema`: `version`, `providers`, `models`, `chains`, empty provider keys, synthetic HTTPS URL/model.

- [ ] **Step 1:** Write failing tests for schema validity, no-secret scanning, bounded output and download headers.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/unit/ai-config/template.test.ts src/__tests__/unit/ai-settings-editor.test.tsx`; expect failure because no template endpoint/action exists.
- [ ] **Step 3:** Add a checked-in static template using `provider-example`, `model-example`, an HTTPS documentation placeholder, empty `apiKey`, and empty chains. Validate it in tests with the same `ConfigSchema`; add a UI action explaining users fill credentials locally and import is validated before saving.
- [ ] **Step 4:** Run focused tests; expect PASS and unchanged masked-key behavior.
- [ ] **Step 5:** Commit with `git add docs/templates src/app/api/ai/config/template src/components src/lib/translations.ts src/__tests__/unit/ai-config/template.test.ts src/__tests__/unit/ai-settings-editor.test.tsx && git commit -m "feat: add credential-free AI config import template"`.

### Task 4: Scope future user imports and complete the release/security gate

**Files:** modify site import route and the private-config route from `2026-09-27-ai-access-and-private-models.md`; modify `src/lib/ai-config/import-diagnostics.ts`; create `src/__tests__/integration/ai-config-export-policy.test.ts`; update `README.md`, `README.en.md`, `docs/deployment-build.md`, and the existing environment template if present.

**Interfaces:** Site-config import remains administrator-only; ordinary users import only into their own private config after the AI-access plan. No route exports another user’s private config or site config while disabled. Docs name `SOLVNOTE_ENABLE_AI_CONFIG_EXPORT` with omission as the safe default.

- [ ] **Step 1:** Write security tests proving a request body/header cannot enable export and import remains usable while export is disabled.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/integration/ai-config-export-policy.test.ts src/__tests__/unit/ai-config`; expect failure for any client-controlled enable path or disabled import.
- [ ] **Step 3:** Keep site import behind live admin/CAS and private imports scoped to the current user; document the variable and secret-handling responsibility without adding Cloudflare/ScanDex OTP.
- [ ] **Step 4:** Run `npm run test:unit`, `npm run test:integration`, `npx tsc --noEmit`, isolated `npm run build`, `git diff --check`, and focused Playwright settings tests. Main worktree must not run `prisma generate`.
- [ ] **Step 5:** Commit with `git add src README.md README.en.md docs/deployment-build.md && git commit -m "test: verify AI configuration export boundaries"`.

## Handoff

Implement after the AI-access plan defines the user-owned route and after user-management policy values are confirmed. Safe rollout order: Task 1, Task 3, Task 2, Task 4. Keep export disabled through local testing and require a separate deployment decision before enabling it.
