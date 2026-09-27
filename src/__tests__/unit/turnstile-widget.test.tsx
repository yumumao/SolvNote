import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget, useRegistrationStatus } from "@/components/turnstile-widget";

const script = vi.hoisted(() => ({ ready: () => {}, error: () => {} }));
vi.mock("next/script", () => ({ default: (props: { onReady: () => void; onError: () => void }) => {
    script.ready = props.onReady; script.error = props.onError; return null;
} }));
let host: HTMLDivElement, root: Root;
const onTokenChange = vi.fn();
const renderWidget = vi.fn();
const removeWidget = vi.fn();
const resetWidget = vi.fn();
const fetchMock = vi.fn();
const configured = { enabled: true, inviteRequired: true, inviteCode: "TEST-INVITE", turnstileSiteKey: "public-test-key", turnstileConfigured: true };
type Callbacks = { callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void; "timeout-callback": () => void; "unsupported-callback": () => void };
function callbacks(): Callbacks { return renderWidget.mock.calls.at(-1)![1]; }
async function mount(resetKey = 0, action: "login" | "register" = "login") {
    await act(async () => root.render(<StrictMode><TurnstileWidget siteKey="public-test-key" action={action} resetKey={resetKey} onTokenChange={onTokenChange} language="en" /></StrictMode>));
    await act(async () => script.ready());
}
beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onTokenChange.mockReset(); renderWidget.mockReset().mockReturnValue("widget-test-id"); removeWidget.mockReset(); resetWidget.mockReset();
    window.turnstile = { render: renderWidget, remove: removeWidget, reset: resetWidget };
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => configured }); vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.turnstile; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("explicit Turnstile widget lifecycle", () => {
    it("renders the requested action without a hidden response field and reports solved tokens", async () => {
        await mount(0, "register");
        expect(renderWidget).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: "public-test-key", action: "register", "response-field": false }));
        await act(async () => callbacks().callback("test-solved-token"));
        expect(onTokenChange).toHaveBeenLastCalledWith("test-solved-token");
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it.each(["expired-callback", "error-callback", "timeout-callback", "unsupported-callback"] as const)("clears the token on %s", async event => {
        await mount(); await act(async () => callbacks().callback("test-solved-token"));
        await act(async () => callbacks()[event]());
        expect(onTokenChange).toHaveBeenLastCalledWith("");
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it("expires a token locally at 300 seconds even if the SDK expiry callback is missed", async () => {
        await mount(); await act(async () => callbacks().callback("test-solved-token"));
        await act(async () => vi.advanceTimersByTimeAsync(300000));
        expect(onTokenChange).toHaveBeenLastCalledWith("");
    });
    it("replaces a consumed widget and ignores late callbacks from its previous generation", async () => {
        await mount(); const old = callbacks(); await act(async () => old.callback("first-token"));
        await mount(1); expect(removeWidget).toHaveBeenCalledWith("widget-test-id");
        const current = callbacks(); onTokenChange.mockClear(); await act(async () => old.callback("stale-token"));
        expect(onTokenChange).not.toHaveBeenCalled();
        await act(async () => current.callback("fresh-token")); expect(onTokenChange).toHaveBeenLastCalledWith("fresh-token");
    });
    it("removes a widget and its timers on unmount and ignores late callbacks", async () => {
        await mount(); const old = callbacks(); await act(async () => old.callback("test-token"));
        await act(async () => root.render(null)); onTokenChange.mockClear();
        await act(async () => old.callback("late-token"));
        expect(onTokenChange).not.toHaveBeenCalled(); expect(removeWidget).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it("fails visibly on script load failure instead of skipping verification", async () => {
        await mount(); await act(async () => script.error());
        expect(onTokenChange).toHaveBeenLastCalledWith("");
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it("ignores a same-tick stale success callback after the script reports failure", async () => {
        await mount(); const old = callbacks();
        await act(async () => { script.error(); old.callback("stale-after-sdk-failure"); });
        expect(onTokenChange).toHaveBeenLastCalledWith("");
    });
    it("fails closed when the SDK cannot render a widget", async () => {
        renderWidget.mockImplementation(() => { throw new Error("SDK unavailable"); }); await mount();
        expect(onTokenChange).toHaveBeenLastCalledWith(""); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it.each(["", " ", "x".repeat(2049)])("rejects malformed SDK tokens (%#)", async token => {
        await mount(); await act(async () => callbacks().callback(token)); expect(onTokenChange).toHaveBeenLastCalledWith("");
    });
    it("bounds an SDK load that never completes", async () => {
        await act(async () => root.render(<TurnstileWidget siteKey="public-test-key" action="login" resetKey={0} onTokenChange={onTokenChange} />));
        await act(async () => vi.advanceTimersByTimeAsync(15000));
        expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
    it("shows missing site configuration instead of rendering a usable widget", async () => {
        await act(async () => root.render(<TurnstileWidget siteKey="" action="login" resetKey={0} onTokenChange={onTokenChange} />));
        await act(async () => script.ready());
        expect(renderWidget).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    });
});

function StatusProbe() {
    const { status, error } = useRegistrationStatus();
    return <output>{error ? "unavailable" : status ? JSON.stringify(status) : "loading"}</output>;
}
describe("registration status loader", () => {
    it("loads and validates the new public endpoint without caching", async () => {
        await act(async () => root.render(<StatusProbe />));
        expect(fetchMock).toHaveBeenCalledWith("/api/registration/status", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
        expect(host.textContent).toContain('"inviteCode":"TEST-INVITE"');
    });
    it.each([null, {}, { ...configured, enabled: "true" }, { ...configured, inviteCode: {} }])("fails closed on malformed public configuration (%#)", async body => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => body });
        await act(async () => root.render(<StatusProbe />)); expect(host.textContent).toBe("unavailable");
    });
    it("fails closed on network or HTTP errors", async () => {
        fetchMock.mockRejectedValue(new Error("offline"));
        await act(async () => root.render(<StatusProbe />)); expect(host.textContent).toBe("unavailable");
    });
    it("bounds status loading and aborts the request", async () => {
        fetchMock.mockReturnValue(new Promise(() => {})); await act(async () => root.render(<StatusProbe />));
        await act(async () => vi.advanceTimersByTimeAsync(10000));
        expect(host.textContent).toBe("unavailable"); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });
});
