"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

export type RegistrationStatus = {
    enabled: boolean;
    inviteRequired: boolean;
    inviteCode: string | null;
    turnstileSiteKey: string;
    turnstileConfigured: boolean;
};

function isRegistrationStatus(value: unknown): value is RegistrationStatus {
    if (!value || typeof value !== "object") return false;
    const data = value as Record<string, unknown>;
    return typeof data.enabled === "boolean" && typeof data.inviteRequired === "boolean"
        && (data.inviteCode === null || typeof data.inviteCode === "string")
        && typeof data.turnstileSiteKey === "string" && typeof data.turnstileConfigured === "boolean";
}

/** Shared by both auth forms. A failed status request never enables either form. */
export function useRegistrationStatus() {
    const [state, setState] = useState<{ status: RegistrationStatus | null; error: boolean }>({ status: null, error: false });
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            if (active) setState({ status: null, error: true });
        }, 10_000);
        void (async () => {
            try {
                const res = await fetch("/api/registration/status", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
                if (!res.ok) throw new Error("Status unavailable");
                const status: unknown = await res.json();
                if (!isRegistrationStatus(status)) throw new Error("Invalid status");
                if (active && !controller.signal.aborted) setState({ status, error: false });
            } catch {
                if (active) setState({ status: null, error: true });
            } finally {
                clearTimeout(timer);
            }
        })();
        return () => { active = false; clearTimeout(timer); controller.abort(); };
    }, []);
    return state;
}

type WidgetOptions = {
    sitekey: string;
    action: "login" | "register";
    language: "en" | "zh-cn";
    "response-field": false;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
    "timeout-callback": () => void;
    "unsupported-callback": () => void;
};

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: WidgetOptions) => string;
            remove: (widgetId: string) => void;
            reset: (widgetId: string) => void;
        };
    }
}

type TurnstileWidgetProps = {
    siteKey: string;
    action: "login" | "register";
    onTokenChange: (token: string) => void;
    resetKey: number;
    language?: string;
};

export function TurnstileWidget({ siteKey, action, onTokenChange, resetKey, language = "en" }: TurnstileWidgetProps) {
    const container = useRef<HTMLDivElement>(null);
    const onChange = useRef(onTokenChange);
    const scriptUsable = useRef(false);
    const [ready, setReady] = useState(false);
    const [scriptFailed, setScriptFailed] = useState(false);
    const [challengeFailed, setChallengeFailed] = useState(false);
    const widgetLanguage = language === "zh" ? "zh-cn" : "en";
    useEffect(() => { onChange.current = onTokenChange; }, [onTokenChange]);

    useEffect(() => {
        if (ready || !siteKey) return;
        const timer = setTimeout(() => { scriptUsable.current = false; setScriptFailed(true); onChange.current(""); }, 15_000);
        return () => clearTimeout(timer);
    }, [ready, siteKey]);

    useEffect(() => {
        if (!ready || scriptFailed || !siteKey || !container.current) return;
        const api = window.turnstile;

        let active = true;
        let widgetId: string | undefined;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const invalidate = () => {
            if (!active) return;
            clearTimeout(expiry);
            onChange.current("");
            setChallengeFailed(true);
        };
        // Defer SDK setup to its own callback; StrictMode/unmount can cancel it.
        // React effects register work instead of synchronously updating form state.
        queueMicrotask(() => {
            if (!active) return;
            onChange.current("");
            setChallengeFailed(false);
            if (!api || !container.current) { invalidate(); return; }
            try {
                widgetId = api.render(container.current, {
                    sitekey: siteKey,
                    action,
                    language: widgetLanguage,
                    "response-field": false,
                    callback: token => {
                        if (!active || !scriptUsable.current) return;
                        if (typeof token !== "string" || !token.trim() || token.length > 2048) { invalidate(); return; }
                        clearTimeout(expiry);
                        setChallengeFailed(false);
                        onChange.current(token);
                        expiry = setTimeout(invalidate, 300_000);
                    },
                    "expired-callback": invalidate,
                    "error-callback": invalidate,
                    "timeout-callback": invalidate,
                    "unsupported-callback": invalidate,
                });
            } catch {
                invalidate();
            }
        });
        return () => {
            active = false;
            clearTimeout(expiry);
            if (widgetId !== undefined) {
                try { api?.remove(widgetId); } catch { /* SDK cleanup failure must not restore a token. */ }
            }
        };
        // Recreate after every attempt: late callbacks from consumed widgets are ignored.
    }, [ready, scriptFailed, siteKey, action, resetKey, widgetLanguage]);

    const unavailable = !siteKey || scriptFailed || challengeFailed;
    return (
        <div className="space-y-2">
            {siteKey && <Script
                id="solvnote-turnstile"
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onReady={() => { scriptUsable.current = true; setScriptFailed(false); setReady(true); }}
                onError={() => { scriptUsable.current = false; setScriptFailed(true); onChange.current(""); }}
            />}
            <div ref={container} aria-label={language === "zh" ? "安全验证" : "Security verification"} />
            {unavailable && <p role="alert" className="text-sm text-red-600">
                {language === "zh" ? "安全验证未完成、已过期或不可用，请重新验证；加载失败时请刷新页面。" : "Security verification is incomplete, expired or unavailable. Retry the challenge, or reload if it failed to load."}
            </p>}
            {!ready && !unavailable && <p role="status" className="text-sm text-muted-foreground">
                {language === "zh" ? "正在加载安全验证…" : "Loading security verification…"}
            </p>}
        </div>
    );
}
