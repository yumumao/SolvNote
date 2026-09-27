"use client";

import { useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";

export default function ChangePasswordPage() {
    const router = useRouter();
    const { language } = useLanguage();
    const zh = language === "zh";
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [completed, setCompleted] = useState(false);
    const inFlight = useRef(false);
    const passwordHelp = zh
        ? "新密码至少15个字符，最多72个UTF-8字节（中文等字符会占多个字节），不要求特定字符组合。"
        : "Use at least 15 characters and at most 72 UTF-8 bytes (some characters use multiple bytes). No character composition rules.";

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (inFlight.current || completed) return;
        inFlight.current = true;
        setError("");
        try {
            if (!currentPassword) { setError(zh ? "请输入当前密码。" : "Enter your current password."); return; }
            if (newPassword.length < 15 || new TextEncoder().encode(newPassword).length > 72) { setError(passwordHelp); return; }
            if (newPassword !== confirmPassword) { setError(zh ? "两次输入的新密码不一致。" : "New passwords do not match."); return; }
            setLoading(true);
            await apiClient.post<unknown>("/api/user/password", { currentPassword, newPassword });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setCompleted(true);
            try {
                await signOut({ redirect: false, callbackUrl: "/login" });
            } catch {
                // The successful password endpoint has already revoked the session.
                // A failed client cookie cleanup must not offer a second password update.
            }
            router.replace("/login");
            router.refresh();
        } catch {
            setError(zh ? "修改密码失败，请检查当前密码后重试。" : "Password change failed. Check your current password and try again.");
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader><CardTitle className="text-2xl text-center">{zh ? "修改密码" : "Change password"}</CardTitle></CardHeader>
                <CardContent>
                    {completed ? <div className="space-y-4">
                        <p role="status">{zh ? "密码已修改，原有会话已失效，请重新登录。" : "Password changed. Previous sessions have been revoked. Sign in again."}</p>
                        <Link href="/login" className="text-primary hover:underline">{zh ? "返回登录" : "Return to login"}</Link>
                    </div> : <form onSubmit={handleSubmit} className="space-y-4">
                        <p className="text-sm text-muted-foreground">{zh ? "修改密码后会退出登录。若管理员要求修改临时密码，请先完成此步骤。" : "Changing your password signs you out. If an administrator issued a temporary password, replace it here before continuing."}</p>
                        <div className="space-y-2">
                            <label htmlFor="currentPassword" className="text-sm font-medium">{zh ? "当前密码" : "Current password"}</label>
                            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="newPassword" className="text-sm font-medium">{zh ? "新密码" : "New password"}</label>
                            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" aria-describedby="password-help" minLength={15} value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                        </div>
                        <p id="password-help" className="text-sm text-muted-foreground">{passwordHelp}</p>
                        <div className="space-y-2">
                            <label htmlFor="confirmPassword" className="text-sm font-medium">{zh ? "确认新密码" : "Confirm new password"}</label>
                            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={15} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                        </div>
                        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? (zh ? "正在修改…" : "Changing password…") : (zh ? "修改密码并重新登录" : "Change password and sign in again")}
                        </Button>
                    </form>}
                </CardContent>
            </Card>
        </div>
    );
}
