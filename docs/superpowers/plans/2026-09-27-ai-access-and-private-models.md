# AI access, default models, and private user models Implementation Plan

> 2026-09-27 publication update: implemented in an isolated worktree; the user confirmed real local verification and authorized GitHub publication. Source publication does not authorize a production migration, image release, or Zeabur restart. Both login and registration require Turnstile; registration and AI export remain opt-in policies. See `docs/user-management.md` for current deployment variables and single-canonical-domain requirements. Historical checkboxes below are not deployment acceptance evidence.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an administrator publish a controlled site AI catalog, select up to three defaults for new users, grant additional site models, and let each user add/edit only their own private AI connections.

**Architecture:** Keep the existing encrypted singleton `AiConfiguration` as the administrator-managed site provider/model source. Add normalized access metadata and per-user grant rows, plus one encrypted per-user configuration. Runtime requests construct an effective allowlisted config for the current live account; no browser receives site keys and no user can write another user’s rows.

**Tech Stack:** Next.js App Router, NextAuth v4, Prisma 5.22/SQLite, Zod, React, Vitest, Playwright, and the existing `src/lib/ai-config` vault/schema.

**Spec:** `D:\work\github\solvnote\.codex\接续入口.md`顶部已确认的AI权限口径，以及`docs/superpowers/plans/2026-09-27-user-management.md`的注册事务接口。

## Global Constraints

- 管理员最多选择三个默认站点AI；新注册用户在注册事务中快照这三项。站点可用模型少于三项时，可选择全部可用模型。
- 额外站点AI只能由管理员授权；用户不能给自己授权站点AI。用户可以创建、修改、停用和删除自己的私有AI。
- 站点密钥继续只存于服务端加密`AiConfiguration`；访问表只存稳定模型ID和权限元数据，DTO绝不返回密钥。
- 现有用户不被静默剥夺权限；兼容迁移只补授权快照，不改角色、密码、错题或现有配置。注册保持关闭直到用户管理策略确认。
- 所有写接口都必须使用严格Zod、同源保护、活跃账户检查、限流/请求大小限制、revision CAS和白名单DTO。
- 稳定模型ID不可复用给另一供应商/模型；站点删除模型时撤销可用性而不是把ID重新指派。
- 实施期间不开放公网注册、不执行生产迁移、不在主工作树运行`prisma generate`、不调用真实AI、不改Zeabur/Cloudflare。

---

### Task 1: Add normalized site access policy and private configuration storage

**Files:** `prisma/schema.prisma`; additive migration under `prisma/migrations/`; create `src/lib/ai-access/policy.ts`, `src/lib/ai-access/types.ts`; tests `src/__tests__/unit/ai-access-policy.test.ts`, `src/__tests__/integration/ai-access-migration.test.ts`.

**Interfaces:**
- `listConfiguredSiteModels(config: PortableConfig): SiteModelSummary[]` returns enabled models/capabilities without provider keys.
- `assertDefaultModelSelection(ids: string[], usableIds: Set<string>): void` throws `DEFAULT_MODEL_LIMIT` or `MODEL_NOT_AVAILABLE`.
- `buildNewUserSiteGrants(ids: string[]): Array<{modelId: string; source:"default"; rank:number}>`.
- Prisma adds `AiSiteModelAccess`, `AiUserModelGrant`, and `UserAiConfiguration`.

- [ ] **Step 1: Write failing tests** for duplicate/unknown/>3 defaults, deterministic rank 1–3, additive migration, and an assertion that grant rows contain no `apiKey` field.
- [ ] **Step 2: Run:** `npx vitest run src/__tests__/unit/ai-access-policy.test.ts src/__tests__/integration/ai-access-migration.test.ts`; expect failure because the helpers/models do not exist.
- [ ] **Step 3: Implement** a site row keyed by stable `modelId` with `isAllowed`, nullable `defaultRank`, revision and timestamps; a user grant keyed by `(userId, modelId)` with `source` (`default`/`admin`), optional rank and timestamps; and one encrypted per-user config row with revision/payload. Use cascading deletes only for user-owned rows. Reconcile current enabled site models without copying keys.
- [ ] **Step 4: Run the same tests; expect PASS** against a disposable database and no existing-table/data changes.
- [ ] **Step 5: Commit:** `git add prisma src/lib/ai-access src/__tests__/unit/ai-access-policy.test.ts src/__tests__/integration/ai-access-migration.test.ts && git commit -m "feat: add normalized AI access policy storage"`.

### Task 2: Add administrator policy and per-user grant APIs

**Files:** create `src/lib/ai-access/admin-store.ts`, `src/app/api/admin/ai/access/route.ts`, `src/app/api/admin/ai/access/users/[id]/route.ts`; modify `src/lib/ai-access.ts`; test `src/__tests__/integration/admin-ai-access.test.ts`.

**Interfaces:** `GET/PATCH /api/admin/ai/access` returns model summaries, allowed state, default ranks and revision; PATCH accepts `{revision, defaultModelIds, allowedModelIds}`. `GET/PATCH /api/admin/ai/access/users/[id]` reads/replaces only that user’s additional grants. `readSiteAccessPolicy()` and `readUserSiteGrants(userId)` always read live DB state.

- [ ] **Step 1: Write failing tests** for non-admin denial, no self-grant, stale revision 409, default subset validation, cross-origin denial, model removal and DTO redaction (serialized output must not contain `apiKey`).
- [ ] **Step 2: Run:** `npx vitest run src/__tests__/integration/admin-ai-access.test.ts`; expect failure because routes do not exist.
- [ ] **Step 3: Implement** live-admin/same-origin guards, bounded JSON and strict schemas. Reconcile site model IDs on every site-config save; mark removed IDs unavailable. Update policy and defaults atomically. When grants change, increment target `sessionVersion` so revoked access disappears immediately.
- [ ] **Step 4: Run focused tests; expect PASS** for CAS, revocation and redaction.
- [ ] **Step 5: Commit:** `git add src/app/api/admin/ai/access src/lib/ai-access.ts src/lib/ai-access/admin-store.ts src/__tests__/integration/admin-ai-access.test.ts && git commit -m "feat: add administrator AI access controls"`.

### Task 3: Snapshot defaults during registration and preserve current users

**Files:** modify `src/lib/user-management/registration.ts` and `src/app/api/register/route.ts`; create `src/lib/ai-access/registration.ts`; modify the access migration; test `src/__tests__/integration/register-ai-access.test.ts`.

**Interfaces:** `createInitialAiGrants(tx, userId, defaultModelIds)` runs in the same transaction as user creation and invite consumption. `migrateExistingUserAiGrants(tx)` inserts compatibility grants only when absent.

- [ ] **Step 1: Write failing tests** proving a new user receives exactly the administrator’s current ordered defaults, a later policy change does not alter the snapshot, and a failed registration rolls back both invite usage and grants.
- [ ] **Step 2: Run:** `npx vitest run src/__tests__/integration/register-ai-access.test.ts`; expect failure because registration has no grant hook.
- [ ] **Step 3: Implement** the hook after Turnstile, invite, password and policy validation, inside the same Prisma transaction. Read defaults transactionally; keep admins able to use the full configured catalog. Compatibility backfill must not delete/rewrite existing AI data and must not enable registration.
- [ ] **Step 4: Run:** `npx vitest run src/__tests__/integration/register-ai-access.test.ts src/__tests__/integration/register-security.test.ts`; expect PASS for rollback, ordering and existing-user preservation.
- [ ] **Step 5: Commit:** `git add src/lib/user-management src/app/api/register src/lib/ai-access/registration.ts prisma src/__tests__/integration/register-ai-access.test.ts && git commit -m "feat: snapshot default AI grants during registration"`.

### Task 4: Build one effective AI configuration boundary

**Files:** create `src/lib/ai-access/effective-config.ts`; modify `src/lib/ai-config/store.ts`, `src/lib/ai-jobs/store.ts`, `src/lib/ai-dialogue/store.ts`, `/api/ai` route handlers and model selectors; test `src/__tests__/integration/effective-ai-access.test.ts`.

**Interface:** `loadEffectiveAIConfig(userId: string): Promise<{config: PortableConfig; revision: number; siteModelIds: string[]; privateModelIds: string[]}>`; `assertModelAllowedForUser(userId: string, modelId: string): Promise<void>`.

- [ ] **Step 1: Write failing tests** proving revoked site models disappear before dispatch while a private model remains, stale account state is rejected, and a client-selected ungranted model cannot run.
- [ ] **Step 2: Run:** `npx vitest run src/__tests__/integration/effective-ai-access.test.ts`; expect failure because routes currently load the complete site config.
- [ ] **Step 3: Implement** admin compatibility (full site config), ordinary-user filtering (only live-granted site provider/model records plus own private config), collision-safe private IDs, and a live grant check before job creation, continuation, model test, polling or import. Never expose provider keys in DTOs.
- [ ] **Step 4: Run:** focused effective-config tests plus existing durable/dialogue suites; expect no cross-user leakage or dispatch after revocation.
- [ ] **Step 5: Commit:** `git add src/lib/ai-access src/lib/ai-config src/lib/ai-jobs src/lib/ai-dialogue src/app/api/ai src/__tests__/integration/effective-ai-access.test.ts && git commit -m "feat: enforce per-user effective AI access"`.
