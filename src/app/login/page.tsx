"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TurnstileWidget, useRegistrationStatus } from "@/components/turnstile-widget";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LoginPage() {
    const router = useRouter();
    const { t, language } = useLanguage();
    const { status, error: statusError } = useRegistrationStatus();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState("");
    const [resetKey, setResetKey] = useState(0);
    const inFlight = useRef(false);
    const configured = Boolean(status?.turnstileConfigured && status.turnstileSiteKey.trim());
    const unavailable = language === "zh"
        ? "安全验证未配置或暂不可用，登录已禁用。请刷新重试或联系管理员。"
        : "Security verification is not configured or unavailable. Login is disabled. Reload or contact the administrator.";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        const token = turnstileToken;
        setTurnstileToken("");
        setError("");
        try {
            if (!configured) { setError(unavailable); return; }
            if (!token) {
                setError(language === "zh" ? "请先完成安全验证。" : "Complete security verification first.");
                return;
            }
            setLoading(true);
            const result = await signIn("credentials", { redirect: false, email, password, turnstileToken: token });
            if (!result?.ok || result.error) {
                setError(t.auth?.login?.failed || "Login failed");
            } else {
                router.push("/");
                router.refresh();
            }
        } catch {
            setError(t.auth?.login?.error || "An error occurred");
        } finally {
            // Tokens are single use, even when credentials or transport fail.
            setTurnstileToken("");
            setResetKey(value => value + 1);
            inFlight.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader><CardTitle className="text-2xl text-center">{t.auth?.login?.title || "Login"}</CardTitle></CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium">{t.auth?.email || "Email"}</label>
                            <Input id="email" name="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium">{t.auth?.password || "Password"}</label>
                            <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
                        </div>
                        {!status && !statusError && <p role="status" className="text-sm text-muted-foreground">{language === "zh" ? "正在加载安全设置…" : "Loading security settings…"}</p>}
                        {(statusError || (status && !configured)) && <p role="alert" className="text-red-600 text-sm">{unavailable}</p>}
                        {configured && <TurnstileWidget siteKey={status!.turnstileSiteKey} action="login" onTokenChange={setTurnstileToken} resetKey={resetKey} language={language} />}
                        {error && <p role="alert" className="text-red-500 text-sm text-center">{error}</p>}
                        <Button type="submit" className="w-full" disabled={loading || !configured || !turnstileToken}>
                            {loading ? (t.auth?.login?.loggingIn || "Logging in...") : (t.auth?.login?.action || "Login")}
                        </Button>
                        {status?.enabled && <div className="text-center text-sm text-muted-foreground">
                            {t.auth?.login?.noAccount || "Don't have an account? "}
                            <Link href="/register" className="text-primary hover:underline">{t.auth?.login?.registerNow || "Register now"}</Link>
                        </div>}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
