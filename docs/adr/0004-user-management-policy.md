# ADR 0004: Account lifecycle, verification and AI permissions

Status: implemented for isolated local acceptance, 2026-09-27; not released.

- Both login and registration use Cloudflare Siteverify. Action and exact trusted hostname must match. Missing settings, network errors or invalid/expired/replayed tokens fail closed. No production bypass switch is provided.
- Registration policy is database-owned and defaults disabled. Legacy `allowRegistration` writes are rejected rather than silently opening a parallel registration path.
- New public accounts default to seven days; administrator choices are seven, thirty or permanent. Administrator-created accounts default permanent. Migration leaves every existing account permanent.
- Invitations default to thirty days and one successful use. Consumption and user/grant creation are one transaction. Renewal never resets usage. List DTOs omit plaintext; only creation and explicitly enabled public auto-fill expose the code.
- Live account existence, active state, expiry and session version are checked at the page/API boundary and sensitive services. Reset/disable/privilege updates revoke sessions. Temporary passwords are returned once and require the current temporary password to set a new one. No silent password editing through profile APIs.
- Permanent cleanup becomes eligible at expiry plus thirty days, runs hourly in bounded batches, uses serializable transactions and retains one administrator recovery account. This exception does not restore access. Detached AI jobs are deleted explicitly; owned database data and inline attachments cascade. External URLs are never filesystem deletion instructions. Audit metadata is retained without credentials.
- New accounts snapshot three selected default site models (all eligible models when fewer than three exist). Administrators can change per-user grants; changes to defaults do not rewrite existing users. Private AI configurations are owner-scoped, encrypted and redacted; runtime rechecks permissions at execution and result boundaries.
- AI export is disabled for all roles by default. Only the deployment-owned `SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=true` flag permits administrator encrypted export. It cannot be set through UI/API configuration. Import/editing and a credential-free template remain available.
- The legacy Openclaw upload endpoint now requires a current site session and same-origin writes; it cannot act as an alternate password/API-key login or upload into another account.

## Consequences

Back up the database and original vault keys before migration. Configure Turnstile before upgrading or new logins will fail. Do not open registration until live verification, permissions and expiry checks pass on an isolated test instance. Existing admin compromise still permits destructive editing and provider calls: disabling exports reduces one exfiltration route, not all consequences of admin compromise. See `docs/user-management.md` for the rollout checklist.
