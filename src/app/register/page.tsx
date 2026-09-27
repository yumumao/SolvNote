"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TurnstileWidget, useRegistrationStatus } from "@/components/turnstile-widget";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import { Eye, EyeOff } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { RegisterRequest } from "@/types/api";

type RegistrationRequest = RegisterRequest & { inviteCode: string; turnstileToken: string };

export default function RegisterPage() {
    const router = useRouter();
    const { t, language } = useLanguage();
    const { status, error: statusError } = useRegistrationStatus();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [educationStage, setEducationStage] = useState("junior_high");
    const [enrollmentYear, setEnrollmentYear] = useState("2025");
    const [enteredInviteCode, setInviteCode] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState("");
    const [resetKey, setResetKey] = useState(0);
    const inFlight = useRef(false);
    const inviteCode = enteredInviteCode ?? status?.inviteCode ?? "";
    const configured = Boolean(status?.turnstileConfigured && status.turnstileSiteKey.trim());
    const unavailable = language === "zh"
        ? "安全验证未配置或暂不可用，注册已禁用。请刷新重试或联系管理员。"
        : "Security verification is not configured or unavailable. Registration is disabled. Reload or contact the administrator.";
    const passwordHelp = language === "zh"
        ? "密码至少8个字符，最多72个UTF-8字节（中文等字符会占多个字节），不要求特定字符组合。"
        : "Use at least 8 characters and at most 72 UTF-8 bytes (some characters use multiple bytes). No character composition rules.";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        const token = turnstileToken;
        setTurnstileToken("");
        setError("");
        try {
            if (!status?.enabled) {
                setError(t.auth?.register?.disabled || "Registration is disabled");
                return;
            }
            if (!configured) { setError(unavailable); return; }
            if (!token) { setError(language === "zh" ? "请先完成安全验证。" : "Complete security verification first."); return; }
            if (password !== confirmPassword) { setError(t.auth?.register?.passwordMismatch || "Passwords do not match"); return; }
            if (password.length < 8 || new TextEncoder().encode(password).length > 72) { setError(passwordHelp); return; }
            if (status.inviteRequired && !inviteCode.trim()) { setError(language === "zh" ? "请输入邀请码。" : "Enter an invitation code."); return; }
            setLoading(true);
            await apiClient.post<unknown, RegistrationRequest>("/api/register", {
                name, email, password, educationStage, enrollmentYear: parseInt(enrollmentYear, 10),
                inviteCode: inviteCode.trim(), turnstileToken: token,
            });
            // The registration token is consumed: never reuse it for automatic login.
            router.push("/login");
        } catch (cause: unknown) {
            const data = cause && typeof cause === "object" && "data" in cause ? cause.data : null;
            const message = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "";
            setError(message === "User with this email already exists"
                ? (t.auth?.register?.emailExists || message)
                : (message || t.auth?.register?.failed || "Registration failed"));
        } finally {
            setTurnstileToken("");
            setResetKey(value => value + 1);
            inFlight.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">
                        {t.auth?.register?.title || 'Create an Account'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!status && !statusError && <p role="status" className="text-sm text-muted-foreground">{language === "zh" ? "正在加载安全设置…" : "Loading security settings…"}</p>}
                        {status?.enabled === false && <p role="alert" className="text-sm text-red-600">{t.auth?.register?.disabledMessage || "Registration is currently disabled by administrator."}</p>}
                        {(statusError || (status && !configured)) && <p role="alert" className="text-sm text-red-600">{unavailable}</p>}
                        <div className="space-y-2">
                            <label htmlFor="name" className="text-sm font-medium">
                                {t.auth?.name || 'Name'}
                            </label>
                            <Input
                                id="name"
                                name="name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium">
                                {t.auth?.email || 'Email'}
                            </label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium">
                                {t.auth?.password || 'Password'}
                            </label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    name="password"
                                    autoComplete="new-password"
                                    aria-describedby="password-help"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    className="pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="confirmPassword" className="text-sm font-medium">
                                {t.auth?.confirmPassword || 'Confirm Password'}
                            </label>
                            <div className="relative">
                                <Input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    autoComplete="new-password"
                                    type={showConfirmPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    className="pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    tabIndex={-1}
                                >
                                    {showConfirmPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="educationStage" className="text-sm font-medium">
                                {t.auth?.educationStage || 'Education Stage'}
                            </label>
                            <select
                                id="educationStage"
                                name="educationStage"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={educationStage}
                                onChange={(e) => setEducationStage(e.target.value)}
                                required
                            >
                                <option value="" disabled>{t.auth?.selectStage || 'Select Stage'}</option>
                                <option value="primary">{t.auth?.primary || 'Primary School'}</option>
                                <option value="junior_high">{t.auth?.juniorHigh || 'Junior High'}</option>
                                <option value="senior_high">{t.auth?.seniorHigh || 'Senior High'}</option>
                                <option value="university">{t.auth?.university || 'University'}</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="enrollmentYear" className="text-sm font-medium">
                                {t.auth?.enrollmentYear || 'Enrollment Year'}
                            </label>
                            <Input
                                id="enrollmentYear"
                                name="enrollmentYear"
                                type="number"
                                value={enrollmentYear}
                                onChange={(e) => setEnrollmentYear(e.target.value)}
                                placeholder="YYYY"
                                required
                                min={1990}
                                max={new Date().getFullYear()}
                            />
                        </div>
                        <p id="password-help" className="text-sm text-muted-foreground">{passwordHelp}</p>
                        {(status?.inviteRequired || inviteCode) && <div className="space-y-2">
                            <label htmlFor="inviteCode" className="text-sm font-medium">{language === "zh" ? "邀请码" : "Invitation code"}</label>
                            <Input id="inviteCode" name="inviteCode" value={inviteCode} onChange={e => setInviteCode(e.target.value)} required={status?.inviteRequired} autoComplete="off" />
                        </div>}
                        {status?.enabled && configured && <TurnstileWidget siteKey={status.turnstileSiteKey} action="register" onTokenChange={setTurnstileToken} resetKey={resetKey} language={language} />}
                        {error && (
                            <div role="alert" className="text-red-500 text-sm text-center">{error}</div>
                        )}
                        <Button type="submit" className="w-full" disabled={loading || !status?.enabled || !configured || !turnstileToken}>
                            {loading
                                ? (t.auth?.register?.registering || 'Registering...')
                                : (t.auth?.register?.action || 'Register')}
                        </Button>
                        <div className="text-center text-sm text-muted-foreground">
                            {t.auth?.register?.hasAccount || "Already have an account? "}
                            <Link href="/login" className="text-primary hover:underline">
                                {t.auth?.register?.loginHere || 'Login here'}
                            </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
