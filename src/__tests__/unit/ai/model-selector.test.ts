// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
    apiClient: { get: mocks.get, post: mocks.post },
}));
vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({ t: {} }),
}));
import { ModelSelector } from "@/components/ui/model-selector";
afterEach(() => {
    vi.unstubAllGlobals();
});
describe("model selector credential transport", () => {
    it("sends credentials in a POST body, never a URL query or browser error log", async () => {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        mocks.post.mockResolvedValue({ models: [] });
        mocks.get.mockResolvedValue({ models: [] });
        try {
            await act(async () => {
                root.render(
                    createElement(ModelSelector, {
                        provider: "openai",
                        apiKey: "fixture-ui-key",
                        baseUrl: "https://api.example.com/v1",
                        currentModel: "demo",
                        onModelChange: vi.fn(),
                    }),
                );
            });
            const refresh = host.querySelector("button");
            expect(refresh).not.toBeNull();
            await act(async () => {
                refresh!.click();
            });
            expect(mocks.post).toHaveBeenCalledWith("/api/ai/models", {
                provider: "openai",
                apiKey: "fixture-ui-key",
                baseUrl: "https://api.example.com/v1",
                model: "demo",
            });
            expect(mocks.get).not.toHaveBeenCalled();
        } finally {
            await act(async () => {
                root.unmount();
            });
            host.remove();
        }
    });
    it("does not log arbitrary request errors that could contain secrets", async () => {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.post.mockRejectedValue(new Error("fixture-request-secret"));
        mocks.get.mockRejectedValue(new Error("fixture-request-secret"));
        try {
            await act(async () => {
                root.render(
                    createElement(ModelSelector, {
                        provider: "gemini",
                        apiKey: "fixture-ui-key",
                        onModelChange: vi.fn(),
                    }),
                );
            });
            await act(async () => {
                host.querySelector("button")!.click();
            });
            expect(host.textContent).not.toContain("fixture-request-secret");
            expect(JSON.stringify(log.mock.calls)).not.toContain(
                "fixture-request-secret",
            );
        } finally {
            await act(async () => {
                root.unmount();
            });
            host.remove();
        }
    });
});
