import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {UserManagement} from "@/components/admin/user-management";
import {ApiError} from "@/lib/api-client";

const mocks = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), patch: vi.fn(), remove: vi.fn(), aiMount: vi.fn(), aiUnmount: vi.fn(), language: "en"}));
vi.mock("@/lib/api-client", async () => ({
    ...await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client"),
    apiClient: {get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.remove},
}));
vi.mock("next-auth/react", () => ({useSession: () => ({data: {user: {id: "self-admin", role: "admin"}}, status: "authenticated"})}));
vi.mock("@/contexts/LanguageContext", () => ({useLanguage: () => ({language: mocks.language, t: {admin: {}, common: {}}})}));
vi.mock("@/components/ai-access-panel", async () => {
    const {useEffect} = await import("react");
    return {AIAccessPanel: function MockAIAccessPanel({userId}: {userId?: string}) {
        useEffect(() => {mocks.aiMount(userId); return () => {mocks.aiUnmount(userId);};}, [userId]);
        return <div data-ai-access-user={userId}>Mock AI access panel</div>;
    }};
});
const baseUser = {id: "user-one", email: "person@example.test", name: "Example Person", role: "user", isActive: true, expiresAt: null as string | null, mustChangePassword: false, revision: 4, createdAt: "2026-09-01T00:00:00Z", _count: {errorItems: 2, practiceRecords: 3}};
const baseSettings = {enabled: true, inviteRequired: true, defaultExpirationDays: null, inviteDefaultLifetimeDays: 30, inviteDisplayEnabled: false, displayedInviteId: null as string | null, revision: 6, turnstileConfigured: true};
const baseInvite = {id: "invite-one", maxUses: 5, usedCount: 2, expiresAt: "2099-10-27T00:00:00Z", enabled: true, revision: 8, createdAt: "2026-09-27T00:00:00Z"};
let users: Array<Omit<typeof baseUser, "_count"> & { _count?: typeof baseUser._count }>;
let settings: typeof baseSettings;
let invites: typeof baseInvite[];
let host: HTMLDivElement, root: Root;
// Synthetic values only. Never invoke the real routes or any external service.
const passwordFixture = "synthetic-once-only-value";
const codeFixture = "synthetic-invite-once-only";
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    for (const fn of [mocks.get, mocks.post, mocks.patch, mocks.remove, mocks.aiMount, mocks.aiUnmount]) fn.mockReset();
    mocks.language = "en"; users = [{...baseUser}]; settings = {...baseSettings}; invites = [{...baseInvite}];
    mocks.get.mockImplementation(async (url: string) => {
        if (url === "/api/admin/users") return users.map(u => ({...u}));
        if (url === "/api/admin/registration") return {...settings};
        if (url === "/api/admin/invites") return invites.map(i => ({...i}));
        return {};
    });
    mocks.post.mockResolvedValue({user: {...baseUser, id: "new-user"}, temporaryPassword: passwordFixture, invite: {...baseInvite, id: "new-invite"}, code: codeFixture});
    mocks.patch.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url === "/api/admin/registration") {settings = {...settings, ...body, revision: settings.revision + 1}; return {...settings};}
        if (url.includes("/invites/")) {invites = invites.map(i => ({...i, ...body, revision: i.revision + 1})); return invites[0];}
        users = users.map(u => ({...u, ...body, revision: u.revision + 1})); return users[0];
    });
    mocks.remove.mockImplementation(async (url: string) => {if (url.includes("/users/")) users = []; else invites[0] = {...invites[0], enabled: false, revision: 9}; return {ok: true};});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
const render = () => act(async () => root.render(<UserManagement/>));
function section(label: string) {const el = host.querySelector<HTMLElement>(`section[aria-label="${label}"]`); expect(el, `section ${label}`).not.toBeNull(); return el!;}
function button(text: string, scope: ParentNode = host) {const el = [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text); expect(el, `button ${text}`).toBeDefined(); return el!;}
const click = (text: string, scope: ParentNode = host) => act(async () => button(text, scope).click());
function field(label: string, scope: ParentNode = host) {const el = scope.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); expect(el, `field ${label}`).not.toBeNull(); return el!;}
async function enter(label: string, value: string, scope: ParentNode = host) {
    await act(async () => {const el = field(label, scope); if (el instanceof HTMLSelectElement) {el.value = value; el.dispatchEvent(new Event("change", {bubbles: true}));} else {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", {bubbles: true}));}});
}
async function toggle(label: string, scope: ParentNode = host) {await act(async () => (field(label, scope) as HTMLInputElement).click());}
async function submit(label: string) {await act(async () => section(label).querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));}
async function fillCreate() {await enter("Name", "New Person", section("Create user")); await enter("Email", "new@example.test", section("Create user"));}

describe("admin user management contracts", () => {
    it("loads only the dedicated safe APIs, never legacy settings", async () => {
        await render(); expect(mocks.get.mock.calls.map(c => c[0]).sort()).toEqual(["/api/admin/invites", "/api/admin/registration", "/api/admin/users"]);
    });
    it("renders safe users without optional counts and shows permanent expiry", async () => {
        delete users[0]._count; await render(); expect(host.textContent).toContain(baseUser.email); expect(host.textContent).toContain("Permanent");
    });
    it("creates a permanent user by default and shows a dismissible one-time password", async () => {
        const storage = vi.spyOn(Storage.prototype, "setItem"); await render(); await fillCreate(); await submit("Create user");
        expect(mocks.post).toHaveBeenCalledWith("/api/admin/users", {email: "new@example.test", name: "New Person", role: "user", expirationDays: null});
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain(passwordFixture); expect(host.textContent).toContain("shown only once");
        await click("I have saved it"); expect(host.textContent).not.toContain(passwordFixture); await click("Refresh"); expect(host.textContent).not.toContain(passwordFixture); expect(storage).not.toHaveBeenCalled();
    });
    it.each(["7", "30"])("creates a %s-day administrator without client-generated credentials", async days => {
        await render(); await fillCreate(); await enter("Role", "admin", section("Create user")); await enter("Account lifetime", days, section("Create user")); await submit("Create user");
        expect(mocks.post).toHaveBeenCalledWith("/api/admin/users", {email: "new@example.test", name: "New Person", role: "admin", expirationDays: Number(days)});
    });
    it.each(["7", "30", "permanent"])("changes expiry to %s with current revision", async days => {
        await render(); const card = section(`User ${baseUser.email}`); await enter("Account lifetime", days, card); await click("Save user", card);
        expect(mocks.patch).toHaveBeenCalledWith("/api/admin/users/user-one", {revision: 4, expirationDays: days === "permanent" ? null : Number(days)});
    });
    it("changes role without silently resetting account expiry", async () => {
        await render(); const card = section(`User ${baseUser.email}`); await enter("Role", "admin", card); await click("Save user", card);
        expect(mocks.patch).toHaveBeenCalledWith("/api/admin/users/user-one", {revision: 4, role: "admin"});
    });
    it("confirms enable/disable and uses the refreshed revision", async () => {
        await render(); await click("Disable user"); expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/users/user-one", {revision: 4, isActive: false});
        await click("Enable user"); expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/users/user-one", {revision: 5, isActive: true});
    });
    it("cancels deletion, then confirms identity and permanent data removal with a JSON revision body", async () => {
        await render(); vi.mocked(window.confirm).mockReturnValue(false); await click("Delete user"); expect(mocks.remove).not.toHaveBeenCalled();
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(baseUser.email)); expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("permanently"));
        vi.mocked(window.confirm).mockReturnValue(true); await click("Delete user"); expect(mocks.remove).toHaveBeenCalledWith("/api/admin/users/user-one", {body: JSON.stringify({revision: 4})}); expect(host.textContent).not.toContain(baseUser.email);
    });
    it("resets passwords with revision and displays only the new one-time value", async () => {
        await render(); await click("Reset password"); expect(mocks.post).toHaveBeenCalledWith("/api/admin/users/user-one/reset-password", {revision: 4});
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("sessions")); expect(host.querySelector('[role="dialog"]')?.textContent).toContain(passwordFixture);
        await click("I have saved it"); expect(host.textContent).not.toContain(passwordFixture);
    });
    it("does not reset passwords after cancellation", async () => {
        await render(); vi.mocked(window.confirm).mockReturnValue(false); await click("Reset password"); expect(mocks.post).not.toHaveBeenCalled();
    });
    it("disables destructive and role/expiry controls for the current administrator", async () => {
        users[0] = {...users[0], id: "self-admin", role: "admin"}; await render();
        for (const text of ["Disable user", "Delete user", "Reset password"]) expect(button(text).disabled).toBe(true);
        const card = section(`User ${baseUser.email}`); expect(field("Role", card).disabled).toBe(true); expect(field("Account lifetime", card).disabled).toBe(true);
    });
    it("prevents duplicate creates and disables all mutations while an action is pending", async () => {
        let resolve!: (v: unknown) => void; mocks.post.mockReturnValue(new Promise(r => {resolve = r;}));
        await render(); await fillCreate(); await act(async () => {const form = section("Create user").querySelector("form")!; form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));});
        expect(mocks.post).toHaveBeenCalledTimes(1); expect(button("Delete user").disabled || button("Delete user").closest("fieldset")?.disabled).toBe(true);
        await act(async () => resolve({user: baseUser, temporaryPassword: passwordFixture}));
    });
    it("refreshes a revision conflict without replaying the write", async () => {
        await render(); users[0].revision = 12; mocks.patch.mockRejectedValueOnce(new ApiError(409, "Conflict", {error: "REVISION_CONFLICT"})); await click("Disable user");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("changed"); expect(mocks.patch).toHaveBeenCalledTimes(1);
        await click("Disable user"); expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/users/user-one", {revision: 12, isActive: false});
    });
    it("does not expose arbitrary error payloads or claim mutation success", async () => {
        await render(); mocks.post.mockRejectedValueOnce(new ApiError(400, "Bad Request", {message: passwordFixture})); await fillCreate(); await submit("Create user");
        expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain(passwordFixture); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
    it("fails closed on initial load failure and offers a fresh retry", async () => {
        mocks.get.mockRejectedValueOnce(new Error("unavailable")); await render(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('section[aria-label="Create user"]')).toBeNull();
        await click("Refresh"); expect(section("Create user")).toBeDefined();
    });
    it("preserves the one-time password if creation succeeded but refresh failed", async () => {
        await render(); await fillCreate(); mocks.get.mockRejectedValueOnce(new Error("refresh unavailable")); await submit("Create user");
        expect(mocks.post).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"]')?.textContent).toContain(passwordFixture); expect(host.querySelector('[role="alert"]')?.textContent).toContain("succeeded");
    });
});

describe("registration policy and invitation controls", () => {
    it("updates only the new registration contract including revision", async () => {
        await render(); const policy = section("Registration policy"); await toggle("Registration enabled", policy); await toggle("Invite required", policy); await enter("Default account lifetime", "7", policy); await submit("Registration policy");
        expect(mocks.patch).toHaveBeenCalledWith("/api/admin/registration", {revision: 6, enabled: false, inviteRequired: false, defaultExpirationDays: 7, inviteDisplayEnabled: false, displayedInviteId: null}); expect(mocks.post).not.toHaveBeenCalled();
    });
    it("selects the public invite and enables its display without sending the code", async () => {
        await render(); const policy = section("Registration policy"); await toggle("Display selected invite publicly", policy); await enter("Displayed invite", "invite-one", policy); await submit("Registration policy");
        expect(mocks.patch).toHaveBeenCalledWith("/api/admin/registration", expect.objectContaining({revision: 6, inviteDisplayEnabled: true, displayedInviteId: "invite-one"})); expect(JSON.stringify(mocks.patch.mock.calls)).not.toContain(codeFixture);
    });
    it("shows missing Turnstile configuration rather than silently promising registration works", async () => {
        settings.turnstileConfigured = false; await render(); expect(host.textContent).toContain("Turnstile is not configured");
    });
    it("creates a 30-day, single-use invite and shows its code once", async () => {
        await render(); await click("Create invite"); expect(mocks.post).toHaveBeenCalledWith("/api/admin/invites", {lifetimeDays: 30, maxUses: 1});
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain(codeFixture); await click("I have saved it"); expect(host.textContent).not.toContain(codeFixture);
    });
    it("renews for 30 days with revision and preserves usage limits", async () => {
        await render(); await click("Renew 30 days"); expect(mocks.patch).toHaveBeenCalledWith("/api/admin/invites/invite-one", {revision: 8, renewDays: 30});
    });
    it("updates maximum uses with revision", async () => {
        await render(); const invite = section("Invite invite-one"); await enter("Maximum uses", "10", invite); await click("Save uses", invite);
        expect(mocks.patch).toHaveBeenCalledWith("/api/admin/invites/invite-one", {revision: 8, maxUses: 10});
    });
    it("prevents limits below already-used count, fractions, and out-of-range values", async () => {
        await render(); const invite = section("Invite invite-one");
        for (const value of ["1", "2.5", "10001", ""]) {await enter("Maximum uses", value, invite); expect(button("Save uses", invite).disabled).toBe(true);}
        expect(mocks.patch).not.toHaveBeenCalled();
    });
    it("revokes invitations via DELETE with revision, without deleting audit history", async () => {
        await render(); await click("Disable invite"); expect(mocks.remove).toHaveBeenCalledWith("/api/admin/invites/invite-one", {body: JSON.stringify({revision: 8})}); expect(host.textContent).toContain("invite-one");
        await click("Enable invite"); expect(mocks.patch).toHaveBeenCalledWith("/api/admin/invites/invite-one", {revision: 9, enabled: true});
    });
    it("does not revoke invites when confirmation is cancelled", async () => {
        await render(); vi.mocked(window.confirm).mockReturnValue(false); await click("Disable invite"); expect(mocks.remove).not.toHaveBeenCalled();
    });
    it("provides local Chinese labels without shared translation changes", async () => {
        mocks.language = "zh"; await render(); expect(host.textContent).toContain("创建用户"); expect(host.textContent).toContain("注册设置"); expect(host.textContent).toContain("创建邀请码");
    });
});

describe("management UI reconciliation and safe one-time display", () => {
    it("never submits invalid create form values", async () => {
        await render(); await submit("Create user"); await enter("Name", "Person", section("Create user")); await enter("Email", "not-an-email", section("Create user")); await submit("Create user");
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it("cancels activation changes without sending a write", async () => {
        await render(); vi.mocked(window.confirm).mockReturnValue(false); await click("Disable user"); expect(mocks.patch).not.toHaveBeenCalled();
    });
    it.each([401, 403])("removes mutable data on HTTP %s, without automatically retrying", async status => {
        await render(); mocks.patch.mockRejectedValueOnce(new ApiError(status, "Denied", {})); await click("Disable user");
        expect(host.textContent).toContain("Administrator access is unavailable"); expect(host.querySelector('section[aria-label="Create user"]')).toBeNull(); expect(mocks.patch).toHaveBeenCalledTimes(1);
    });
    it.each([['LAST_ADMIN', 'last active administrator'], ['SELF_ACTION_DENIED', 'own administrator'], ['TURNSTILE_NOT_CONFIGURED', 'Turnstile is not configured']])("maps protected error %s without exposing raw response data", async (code, text) => {
        await render(); mocks.patch.mockRejectedValueOnce(new ApiError(409, "Conflict", {error: code, details: passwordFixture})); await click("Disable user");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(text); expect(host.textContent).not.toContain(passwordFixture);
    });
    it("requires a fresh explicit submit after a registration-policy revision conflict", async () => {
        await render(); settings.revision = 14; settings.enabled = false; mocks.patch.mockRejectedValueOnce(new ApiError(409, "Conflict", {error: "REVISION_CONFLICT"})); await submit("Registration policy");
        expect(mocks.patch).toHaveBeenCalledTimes(1); expect((field("Registration enabled") as HTMLInputElement).checked).toBe(false);
        await submit("Registration policy"); expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/registration", expect.objectContaining({revision: 14, enabled: false}));
    });
    it("renews with the updated invite revision after a conflict", async () => {
        await render(); invites[0].revision = 15; mocks.patch.mockRejectedValueOnce(new ApiError(409, "Conflict", {error: "REVISION_CONFLICT"})); await click("Renew 30 days");
        expect(mocks.patch).toHaveBeenCalledTimes(1); await click("Renew 30 days"); expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/invites/invite-one", {revision: 15, renewDays: 30});
    });
    it("marks expired users and excludes unusable invites from new public selections", async () => {
        users[0] = {...users[0], expiresAt: "2001-01-01T00:00:00Z"};
        invites = [{...baseInvite, id: "expired", expiresAt: "2001-01-01T00:00:00Z"}, {...baseInvite, id: "disabled", enabled: false}, {...baseInvite, id: "used-up", usedCount: 5}, {...baseInvite}];
        await render(); expect(section(`User ${baseUser.email}`).textContent).toContain("Expired");
        const options = (field("Displayed invite") as HTMLSelectElement).options;
        for (const id of ["expired", "disabled", "used-up"]) expect([...options].find(o => o.value === id)?.disabled).toBe(true);
        expect([...options].find(o => o.value === "invite-one")?.disabled).toBe(false);
    });
    it("clears old one-time credentials before another mutation, even when it fails", async () => {
        await render(); await click("Reset password"); expect(host.textContent).toContain(passwordFixture);
        mocks.post.mockRejectedValueOnce(new ApiError(500, "Unavailable", {})); await click("Create invite"); expect(host.textContent).not.toContain(passwordFixture); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
    it("never renders one-time values as HTML and drops them on unmount", async () => {
        const value = '<img src="x" onerror="alert(1)">'; mocks.post.mockResolvedValueOnce({temporaryPassword: value});
        await render(); await click("Reset password"); expect(host.querySelector('[role="dialog"]')?.textContent).toContain(value); expect(host.querySelector("img")).toBeNull();
        await act(async () => root.unmount()); root = createRoot(host); await render(); expect(host.textContent).not.toContain(value);
    });
    it("ignores late responses from the discarded StrictMode mount", async () => {
        let resolve!: (v: unknown) => void;
        mocks.get.mockImplementationOnce(() => new Promise(r => {resolve = r;}));
        const {StrictMode} = await import("react"); await act(async () => root.render(<StrictMode><UserManagement/></StrictMode>));
        expect(host.textContent).toContain(baseUser.email);
        await act(async () => resolve([{...baseUser, email: "stale@example.test"}]));
        expect(host.textContent).not.toContain("stale@example.test"); expect(host.textContent).toContain(baseUser.email);
    });
});

describe("on-demand user AI access panel", () => {
    it("does not mount any AI panel while listing users", async () => {
        users.push({...baseUser, id: "user-two", email: "second@example.test"}); await render();
        expect(host.querySelectorAll('[data-ai-access-user]')).toHaveLength(0); expect(mocks.aiMount).not.toHaveBeenCalled();
        expect(button("AI access", section(`User ${baseUser.email}`)).getAttribute("aria-expanded")).toBe("false");
    });
    it("opens the selected account only and links the expanded button to its panel", async () => {
        await render(); await click("AI access", section(`User ${baseUser.email}`));
        expect(host.querySelectorAll('[data-ai-access-user]')).toHaveLength(1); expect(host.querySelector('[data-ai-access-user]')?.getAttribute("data-ai-access-user")).toBe("user-one");
        const trigger = button("AI access", section(`User ${baseUser.email}`)); expect(trigger.getAttribute("aria-expanded")).toBe("true");
        const panel = document.getElementById(trigger.getAttribute("aria-controls")!); expect(panel?.textContent).toContain(baseUser.email);
        expect(panel?.textContent).toContain("site-wide policy"); expect(mocks.aiMount).toHaveBeenCalledExactlyOnceWith("user-one");
    });
    it("replaces rather than accumulates panels when switching selected users", async () => {
        users.push({...baseUser, id: "user-two", email: "second@example.test"}); await render();
        await click("AI access", section(`User ${baseUser.email}`)); const first = host.querySelector('[data-ai-access-user]');
        await click("AI access", section("User second@example.test"));
        expect(host.querySelectorAll('[data-ai-access-user]')).toHaveLength(1); expect(host.querySelector('[data-ai-access-user]')?.getAttribute("data-ai-access-user")).toBe("user-two");
        expect(host.querySelector('[data-ai-access-user]')).not.toBe(first); expect(mocks.aiUnmount).toHaveBeenCalledWith("user-one");
        expect(button("AI access", section(`User ${baseUser.email}`)).getAttribute("aria-expanded")).toBe("false");
    });
    it("unmounts when toggled closed or closed via the panel button", async () => {
        await render(); await click("AI access"); await click("AI access"); expect(host.querySelector('[data-ai-access-user]')).toBeNull(); expect(mocks.aiUnmount).toHaveBeenCalledWith("user-one");
        await click("AI access"); await click("Close AI access"); expect(host.querySelector('[data-ai-access-user]')).toBeNull();
    });
    it("allows the current administrator to open their own grants without enabling destructive account actions", async () => {
        users[0] = {...users[0], id: "self-admin", role: "admin"}; await render(); await click("AI access");
        expect(mocks.aiMount).toHaveBeenCalledExactlyOnceWith("self-admin"); expect(button("Delete user").disabled).toBe(true);
    });
    it("unmounts the selected account panel after the account is deleted", async () => {
        await render(); await click("AI access"); await click("Delete user"); expect(host.querySelector('[data-ai-access-user]')).toBeNull(); expect(mocks.aiUnmount).toHaveBeenCalledWith("user-one");
    });
    it("unmounts the panel when management authorization is rejected", async () => {
        await render(); await click("AI access"); mocks.patch.mockRejectedValueOnce(new ApiError(403, "Denied", {})); await click("Disable user");
        expect(host.querySelector('[data-ai-access-user]')).toBeNull(); expect(mocks.aiUnmount).toHaveBeenCalledWith("user-one");
    });
    it("provides local Chinese AI access controls", async () => {
        mocks.language = "zh"; await render(); await click("AI授权"); expect(host.querySelector('[data-ai-access-user]')).not.toBeNull();
        expect(host.textContent).toContain("站点级策略"); await click("关闭AI授权"); expect(host.querySelector('[data-ai-access-user]')).toBeNull();
    });
});
