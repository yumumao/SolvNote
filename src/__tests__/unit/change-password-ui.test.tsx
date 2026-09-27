import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChangePasswordPage from "@/app/change-password/page";

const { post, signOut, router } = vi.hoisted(() => ({ post: vi.fn(), signOut: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { post } }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
let host: HTMLDivElement, root: Root;
async function input(name: string, value: string) {
    const el = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!; expect(el).not.toBeNull();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function mount(password = "new-test-passphrase") {
    await act(async () => root.render(<ChangePasswordPage />)); await input("currentPassword", "old");
    await input("newPassword", password); await input("confirmPassword", password);
}
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    post.mockReset().mockResolvedValue({ success: true }); signOut.mockReset().mockResolvedValue({ url: "/login" }); router.replace.mockReset(); router.refresh.mockReset();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("password change and revoked-session UI", () => {
    it("posts exactly currentPassword/newPassword, then signs out and returns to login", async () => {
        await mount(); await submit();
        expect(post).toHaveBeenCalledWith("/api/user/password", { currentPassword: "old", newPassword: "new-test-passphrase" });
        expect(signOut).toHaveBeenCalledWith({ redirect: false, callbackUrl: "/login" });
        expect(post.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
        expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(router.replace.mock.invocationCallOrder[0]);
        expect(router.replace).toHaveBeenCalledWith("/login"); expect(router.refresh).toHaveBeenCalled();
        expect(host.querySelector<HTMLInputElement>('[name="currentPassword"]')?.value ?? "").toBe("");
    });
    it("never applies the new minimum to an old current password", async () => {
        await mount(); expect(host.querySelector<HTMLInputElement>('[name="currentPassword"]')!.minLength).toBeLessThan(8);
        expect(host.querySelector<HTMLInputElement>('[name="newPassword"]')!.minLength).toBe(8);
        expect(host.textContent).toContain("72"); await submit(); expect(post).toHaveBeenCalledTimes(1);
    });
    it.each(["x".repeat(7), "x".repeat(73), "中".repeat(25)])("rejects invalid new-password lengths locally (%#)", async password => {
        await mount(password); await submit(); expect(post).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it.each(["abcdefgh", "12345678", "x".repeat(14)])("accepts an 8-to-14-character replacement and revokes the old session (%#)", async password => {
        await mount(password);
        expect(host.querySelector<HTMLInputElement>('[name="confirmPassword"]')?.minLength).toBe(8);
        expect(host.textContent).toContain("at least 8 characters");
        await submit();
        expect(post).toHaveBeenCalledWith("/api/user/password", { currentPassword: "old", newPassword: password });
        expect(signOut).toHaveBeenCalledTimes(1);
    });
    it("matches the core schema and HTML string-length contract for supplementary Unicode", async () => {
        await mount("😀".repeat(4)); await submit(); expect(post).toHaveBeenCalledTimes(1);
    });
    it("accepts the 72-byte multibyte boundary without composition requirements", async () => {
        await mount("中".repeat(24)); await submit(); expect(post).toHaveBeenCalledTimes(1);
    });
    it("blocks mismatched confirmation without calling the API", async () => {
        await mount(); await input("confirmPassword", "different-test-passphrase"); await submit(); expect(post).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
    });
    it("keeps the session and shows failure when the password endpoint rejects the change", async () => {
        post.mockRejectedValue({ data: { message: "Rejected" } }); await mount(); await submit();
        expect(signOut).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy(); expect(host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(false);
    });
    it("returns to login even if client sign-out fails after server-side session revocation", async () => {
        signOut.mockRejectedValue(new Error("offline")); await mount(); await submit();
        expect(router.replace).toHaveBeenCalledWith("/login");
        expect(host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled ?? true).toBe(true);
    });
    it("serializes duplicate submits and does not resubmit after a successful change", async () => {
        let finish!: (value: unknown) => void; post.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await mount();
        await act(async () => { const form = host.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(post).toHaveBeenCalledTimes(1); await act(async () => finish({ success: true }));
        expect(host.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled ?? true).toBe(true);
    });
});
