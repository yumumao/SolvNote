import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

const { auth, api, router, script } = vi.hoisted(() => ({
    auth: { signIn: vi.fn() }, api: { post: vi.fn() },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    script: { ready: () => {}, error: () => {} },
}));
vi.mock("next-auth/react", () => ({ signIn: auth.signIn }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ t: {}, language: "en" }) }));
vi.mock("@/lib/api-client", () => ({ apiClient: api }));
vi.mock("next/script", () => ({ default: (props: { onReady: () => void; onError: () => void }) => {
    script.ready = props.onReady; script.error = props.onError; return null;
} }));
let host: HTMLDivElement, root: Root;
const fetchMock = vi.fn(), renderWidget = vi.fn(), removeWidget = vi.fn();
const status = { enabled: true, inviteRequired: true, inviteCode: null, turnstileSiteKey: "test-public-key", turnstileConfigured: true };
function configure(overrides: Record<string, unknown> = {}) { fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...status, ...overrides }) }); }
async function mount(page: ReactNode) { await act(async () => root.render(page)); await act(async () => script.ready()); }
async function input(name: string, value: string) {
    const el = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; expect(el).not.toBeNull();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function solve(token = "test-fresh-token") { expect(renderWidget).toHaveBeenCalled(); await act(async () => renderWidget.mock.calls.at(-1)![1].callback(token)); }
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
function submitDisabled() { return host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled ?? true; }
async function registerFields(password = "test-passphrase-long") {
    await input("name", "Test user"); await input("email", "person@example.test");
    await input("password", password); await input("confirmPassword", password);
    const invite = host.querySelector<HTMLInputElement>('input[name="inviteCode"]'); if (invite) await input("inviteCode", "TEST-INVITE");
}
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("alert", vi.fn());
    auth.signIn.mockReset().mockResolvedValue({ ok: false, error: "CredentialsSignin" }); api.post.mockReset().mockResolvedValue({ success: true });
    router.push.mockReset(); router.replace.mockReset(); router.refresh.mockReset();
    fetchMock.mockReset(); configure(); vi.stubGlobal("fetch", fetchMock);
    renderWidget.mockReset().mockReturnValue("test-widget-id"); removeWidget.mockReset();
    window.turnstile = { render: renderWidget, remove: removeWidget, reset: vi.fn() };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.turnstile; vi.unstubAllGlobals(); });

describe("login requires Turnstile even for ordinary existing credentials", () => {
    it("loads the agreed endpoint and blocks normal login until the login challenge is solved", async () => {
        await mount(<LoginPage />); await input("email", "person@example.test"); await input("password", "old");
        expect(fetchMock).toHaveBeenCalledWith("/api/registration/status", expect.anything());
        expect(submitDisabled()).toBe(true); await submit(); expect(auth.signIn).not.toHaveBeenCalled();
        await solve(); expect(submitDisabled()).toBe(false);
        expect(renderWidget.mock.calls.at(-1)![1].action).toBe("login");
        expect(host.querySelector<HTMLInputElement>('[name="password"]')!.minLength).toBeLessThan(15);
    });
    it.each([{ turnstileConfigured: false }, { turnstileSiteKey: "" }])("visibly blocks missing configuration (%#)", async config => {
        configure(config); await mount(<LoginPage />); expect(submitDisabled()).toBe(true);
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
        await submit(); expect(auth.signIn).not.toHaveBeenCalled();
    });
    it("fails closed when status cannot be fetched", async () => {
        fetchMock.mockRejectedValue(new Error("offline")); await mount(<LoginPage />);
        expect(submitDisabled()).toBe(true); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
        await submit(); expect(auth.signIn).not.toHaveBeenCalled();
    });
    it("allows login when registration is closed, but still requires and consumes a token", async () => {
        configure({ enabled: false }); await mount(<LoginPage />); await input("email", "person@example.test"); await input("password", "old"); await solve();
        await submit(); expect(auth.signIn).toHaveBeenCalledWith("credentials", { redirect: false, email: "person@example.test", password: "old", turnstileToken: "test-fresh-token" });
        expect(submitDisabled()).toBe(true); expect(removeWidget).toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
        await submit(); expect(auth.signIn).toHaveBeenCalledTimes(1);
    });
    it("requires a fresh token after a rejected or thrown login attempt", async () => {
        auth.signIn.mockRejectedValueOnce(new Error("offline")); await mount(<LoginPage />); await solve(); await submit();
        expect(submitDisabled()).toBe(true); await submit(); expect(auth.signIn).toHaveBeenCalledTimes(1);
        await solve("second-fresh-token"); await submit(); expect(auth.signIn.mock.calls[1][1].turnstileToken).toBe("second-fresh-token");
    });
    it("navigates only after explicit successful sign-in, and resets the consumed token", async () => {
        auth.signIn.mockResolvedValue({ ok: true, error: null }); await mount(<LoginPage />); await solve(); await submit();
        expect(router.push).toHaveBeenCalledWith("/"); expect(removeWidget).toHaveBeenCalled(); expect(submitDisabled()).toBe(true);
    });
    it("does not mistake an undefined sign-in response for success", async () => {
        auth.signIn.mockResolvedValue(undefined); await mount(<LoginPage />); await solve(); await submit();
        expect(router.push).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it("serializes same-tick duplicate submits", async () => {
        let finish!: (value: unknown) => void; auth.signIn.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        await mount(<LoginPage />); await solve();
        await act(async () => { const form = host.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(auth.signIn).toHaveBeenCalledTimes(1);
        await act(async () => finish({ ok: false, error: "CredentialsSignin" }));
    });
});

describe("registration status, invitation, password and Turnstile contracts", () => {
    it("uses a register-action token, invite and only allowed profile fields; redirects without auto-login", async () => {
        await mount(<RegisterPage />); await registerFields(); expect(submitDisabled()).toBe(true); await solve();
        expect(renderWidget.mock.calls.at(-1)![1].action).toBe("register"); await submit();
        expect(api.post).toHaveBeenCalledWith("/api/register", {
            name: "Test user", email: "person@example.test", password: "test-passphrase-long", educationStage: "junior_high", enrollmentYear: 2025,
            inviteCode: "TEST-INVITE", turnstileToken: "test-fresh-token",
        });
        expect(auth.signIn).not.toHaveBeenCalled(); expect(router.push).toHaveBeenCalledWith("/login"); expect(submitDisabled()).toBe(true);
    });
    it("prefills a public invite but allows entry when its value is null", async () => {
        configure({ inviteCode: "PUBLIC-INVITE" }); await mount(<RegisterPage />);
        expect(host.querySelector<HTMLInputElement>('input[name="inviteCode"]')?.value).toBe("PUBLIC-INVITE");
        expect(host.querySelector<HTMLInputElement>('input[name="inviteCode"]')?.required).toBe(true);
    });
    it.each([{ enabled: false }, { turnstileConfigured: false }, { turnstileSiteKey: "" }])("visibly disables registration when status forbids it (%#)", async config => {
        configure(config); await mount(<RegisterPage />); expect(submitDisabled()).toBe(true);
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy(); expect(api.post).not.toHaveBeenCalled();
    });
    it("does not default to open registration when status fails", async () => {
        fetchMock.mockRejectedValue(new Error("offline")); await mount(<RegisterPage />);
        expect(submitDisabled()).toBe(true); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy(); expect(api.post).not.toHaveBeenCalled();
    });
    it("clears verification on local validation failure as well as API failure", async () => {
        await mount(<RegisterPage />); await registerFields(); await input("confirmPassword", "different-passphrase"); await solve(); await submit();
        expect(api.post).not.toHaveBeenCalled(); expect(submitDisabled()).toBe(true);
        await input("confirmPassword", "test-passphrase-long"); await solve("second-token"); api.post.mockRejectedValue({ data: { message: "Rejected" } }); await submit();
        expect(submitDisabled()).toBe(true); await submit(); expect(api.post).toHaveBeenCalledTimes(1);
    });
    it.each(["x".repeat(14), "x".repeat(73), "中".repeat(25)])("enforces 15 characters and 72 UTF-8 bytes without submitting invalid passwords (%#)", async password => {
        await mount(<RegisterPage />); await registerFields(password); await solve(); await submit();
        expect(api.post).not.toHaveBeenCalled(); expect(submitDisabled()).toBe(true);
        expect(host.textContent).toContain("72"); expect(host.querySelector<HTMLInputElement>('[name="password"]')?.minLength).toBe(15);
    });
    it("uses the same string length as the core schema and HTML minLength for supplementary Unicode", async () => {
        await mount(<RegisterPage />); await registerFields("😀".repeat(7) + "x"); await solve(); await submit();
        expect(api.post).toHaveBeenCalledTimes(1);
    });
    it("accepts a 72-byte multibyte passphrase without composition requirements", async () => {
        await mount(<RegisterPage />); await registerFields("中".repeat(24)); await solve(); await submit();
        expect(api.post).toHaveBeenCalledTimes(1);
    });
});
