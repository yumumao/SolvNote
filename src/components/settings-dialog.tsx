"use client";
import { APP_REPOSITORY, APP_UPSTREAM, APP_ISSUES, APP_CHANGELOG } from "@/lib/app-info";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Trash2, Loader2, AlertTriangle, Languages, User, Bot, Shield, RefreshCw, CheckCircle2, Download, Upload, BarChart3 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { UserManagement } from "@/components/admin/user-management";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { AppConfig, UserProfile, UpdateUserProfileRequest } from "@/types/api";
import { PromptSettings } from "@/components/settings/prompt-settings";

import { MessageSquareText, Info, ExternalLink, Github, ScrollText } from "lucide-react";
interface ProfileFormState {
    name: string;
    email: string;
    educationStage: string;
    enrollmentYear: string | number;
}

export function SettingsDialog() {
    const { data: session } = useSession();
    const { t, language, setLanguage } = useLanguage();
    const [open, setOpen] = useState(false);
    const dialogContentRef = useRef<HTMLDivElement>(null);
    const [clearingPractice, setClearingPractice] = useState(false);
    const [clearingError, setClearingError] = useState(false);
    const [systemResetting, setSystemResetting] = useState(false);
    const [migratingTags, setMigratingTags] = useState(false);
    const [saving, setSaving] = useState(false);
    const [, setLoading] = useState(false);
    const [version, setVersion] = useState<string>("");
    const [config, setConfig] = useState<AppConfig>({ aiProvider: 'gemini' });
    // Profile State
    const [profile, setProfile] = useState<ProfileFormState>({
        name: "",
        email: "",
        educationStage: "",
        enrollmentYear: ""
    });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);

    // Import/Export state
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string>("");

    const router = useRouter();

    useEffect(() => {
        if (open) {
            fetchSettings();
            fetchProfile();
        }
        // 获取版本号
        fetch("/api/version")
            .then((res) => res.json())
            .then((data) => setVersion(data.version))
            .catch(() => {});
    }, [open]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<AppConfig>("/api/settings");
            setConfig(data);
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Failed to fetch settings', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoading(false);
        }
    };

    const fetchProfile = async () => {
        setProfileLoading(true);
        try {
            const data = await apiClient.get<UserProfile>("/api/user");
            setProfile({
                name: data.name || "",
                email: data.email || "",
                educationStage: data.educationStage || "",
                enrollmentYear: data.enrollmentYear || "",
            });
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Failed to fetch profile', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            setProfileLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await apiClient.post("/api/settings", {prompts:config.prompts,timeouts:config.timeouts});
            alert(t.settings?.messages?.saved || "Settings saved");
            // 保存成功后滚动到顶部，方便关闭对话框
            dialogContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Failed to save settings', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.messages?.saveFailed || "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const handleSaveProfile = async () => {
        setProfileSaving(true);
        try {
            const payload: UpdateUserProfileRequest = {
                name: profile.name,
                email: profile.email,
                ...(profile.educationStage ? { educationStage: profile.educationStage } : {}),
            };

            if (profile.enrollmentYear) {
                payload.enrollmentYear = parseInt(profile.enrollmentYear.toString());
            }

            await apiClient.patch("/api/user", payload);

            alert(t.settings?.messages?.profileUpdated || "Profile updated");
            window.location.reload(); // Reload to update user name in UI
        } catch (error: any) {
            frontendLogger.error('[SettingsDialog]', 'Failed to update profile', { error: error?.data?.message || error?.message || String(error) });
            const message = error.data?.message || (t.settings?.messages?.updateFailed || "Update failed");
            alert(message);
        } finally {
            setProfileSaving(false);
        }
    };

    const handleClearData = async () => {
        if (!confirm(t.settings?.clearDataConfirm || "Are you sure?")) {
            return;
        }

        setClearingPractice(true);
        try {
            await apiClient.delete("/api/stats/practice/clear");
            alert(t.settings?.clearSuccess || "Success");
            setOpen(false);
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Failed to clear practice data', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.clearError || "Failed");
        } finally {
            setClearingPractice(false);
        }
    };

    const handleClearErrorData = async () => {
        if (!confirm(t.settings?.clearErrorDataConfirm || "Are you sure?")) {
            return;
        }

        setClearingError(true);
        try {
            await apiClient.delete("/api/error-items/clear");
            alert(t.settings?.clearSuccess || "Success");
            setOpen(false);
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Failed to clear error data', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.clearError || "Failed");
        } finally {
            setClearingError(false);
        }
    };

    const handleSystemReset = async () => {
        // Double confirm
        if (!confirm(t.settings?.systemResetConfirm || "WARNING: Deleting ALL data. Undoing is impossible. Are you sure?")) {
            return;
        }

        // Optional triple confirm?
        const userInput = prompt(t.settings?.systemResetPrompt || "Type 'RESET' to confirm system initialization:", "");
        if (userInput !== 'RESET') {
            if (userInput !== null) alert(t.common?.error || "Confirmation failed");
            return;
        }

        setSystemResetting(true);
        try {
            await apiClient.post("/api/admin/system-reset", {});
            alert(t.settings?.clearSuccess || "Success - System Reset Complete");
            setOpen(false);
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'System reset failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.clearError || "Failed to reset system");
        } finally {
            setSystemResetting(false);
        }
    };

    const handleExportData = async () => {
        setExporting(true);
        try {
            const res = await fetch('/api/export');
            if (!res.ok) {
                throw new Error('Export failed');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Get filename from Content-Disposition header or use default
            const disposition = res.headers.get('Content-Disposition');
            const filenameMatch = disposition?.match(/filename="(.+)"/);
            a.download = filenameMatch ? filenameMatch[1] : 'solvnote-export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            alert(t.settings?.exportSuccess || "Export successful");
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Export failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.exportFailed || "Export failed");
        } finally {
            setExporting(false);
        }
    };

    const handleExportAllData = async () => {
        if (!confirm(t.settings?.exportAllConfirm || "Export all users' data? This may take a while.")) {
            return;
        }
        setExporting(true);
        try {
            const res = await fetch('/api/export?all=true');
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Export failed');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const disposition = res.headers.get('Content-Disposition');
            const filenameMatch = disposition?.match(/filename="(.+)"/);
            a.download = filenameMatch ? filenameMatch[1] : 'solvnote-export-all.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            alert(t.settings?.exportSuccess || "Export successful");
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Export all failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.exportFailed || "Export failed");
        } finally {
            setExporting(false);
        }
    };

    const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setSelectedFileName(file.name);
        }
    };

    const handleImportData = async () => {
        if (!selectedFile) return;

        if (!confirm(t.settings?.importConfirm || "Are you sure you want to import?")) {
            return;
        }

        setImporting(true);
        try {
            const text = await selectedFile.text();
            const data = JSON.parse(text);

            const response = await apiClient.post('/api/import', data);
            const stats = (response as any).stats;

            alert(
                (t.settings?.importResultDesc || "Imported {subjects} notebooks, {tags} tags, {items} error items, {schedules} review schedules, {records} practice records.")
                    .replace('{subjects}', String(stats.subjectsCreated))
                    .replace('{tags}', String(stats.tagsCreated))
                    .replace('{items}', String(stats.errorItemsCreated))
                    .replace('{schedules}', String(stats.reviewSchedulesCreated))
                    .replace('{records}', String(stats.practiceRecordsCreated))
            );

            setSelectedFile(null);
            setSelectedFileName("");
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Import failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.importFailed || "Import failed");
        } finally {
            setImporting(false);
        }
    };

    const handleImportAllData = async () => {
        if (!selectedFile) return;

        if (!confirm(t.settings?.importAllConfirm || "Import all users' data? This will restore data for all users from the export file.")) {
            return;
        }

        setImporting(true);
        try {
            const text = await selectedFile.text();
            const data = JSON.parse(text);
            const res = await fetch("/api/import?all=true", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const result = await res.json();
            if (result.success) {
                const s = result.stats;
                alert(
                    (t.settings?.importResultDesc || "Imported {subjects} notebooks, {tags} tags, {items} error items, {schedules} review schedules, {records} practice records.")
                        .replace('{subjects}', String(s.subjectsCreated))
                        .replace('{tags}', String(s.tagsCreated))
                        .replace('{items}', String(s.errorItemsCreated))
                        .replace('{schedules}', String(s.reviewSchedulesCreated))
                        .replace('{records}', String(s.practiceRecordsCreated))
                );
                setSelectedFile(null);
                setSelectedFileName("");
                window.location.reload();
            } else {
                throw new Error(result.message || "Import failed");
            }
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Import all failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.importFailed || "Import failed");
        } finally {
            setImporting(false);
        }
    };

    const handleMigrateTags = async () => {
        if (!confirm(t.settings?.migrateTagsConfirm || "This will reset system tags. Confirm?")) {
            return;
        }

        setMigratingTags(true);
        try {
            const res = await apiClient.post("/api/admin/migrate-tags", {});
            alert(`${t.settings?.clearSuccess || "Success"}: ${(res as any).count || 0} tags migrated.`);
            // No reload needed necessarily, but good to refresh if user is viewing tags.
        } catch (error) {
            frontendLogger.error('[SettingsDialog]', 'Tag migration failed', { error: error instanceof Error ? error.message : String(error) });
            alert(t.settings?.clearError || "Failed to migrate tags");
        } finally {
            setMigratingTags(false);
        }
    };

    const updatePrompts = (type: 'analyze' | 'similar', value: string) => {
        setConfig(prev => ({
            ...prev,
            prompts: {
                ...prev.prompts,
                [type]: value
            }
        }));
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                    <Settings className="h-5 w-5" />
                    <span className="sr-only">{t.settings?.title || "Settings"}</span>
                </Button>
            </DialogTrigger>
            <DialogContent ref={dialogContentRef} className="w-[calc(100vw-2rem)] sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t.settings?.title || "Settings"}</DialogTitle>
                    <DialogDescription>
                        {t.settings?.desc || 'Manage your preferences and data.'}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="general" className="w-full">
                    <TabsList className={`grid w-full grid-cols-4 ${(session?.user as any)?.role === 'admin' ? 'sm:grid-cols-7' : 'sm:grid-cols-4'} gap-1 h-auto`}>
                        <TabsTrigger value="general" className="px-2 sm:px-3">
                            <Languages className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.general || "General"}</span>
                        </TabsTrigger>
                        <TabsTrigger value="account" className="px-2 sm:px-3">
                            <User className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.account || "Account"}</span>
                        </TabsTrigger>
                        {(session?.user as any)?.role === 'admin' && (
                            <>
                                <TabsTrigger value="ai" className="px-2 sm:px-3">
                                    <Bot className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.ai || "AI Provider"}</span>
                                </TabsTrigger>
                                <TabsTrigger value="prompts" className="px-2 sm:px-3">
                                    <MessageSquareText className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.prompts || "Prompts"}</span>
                                </TabsTrigger>
                                <TabsTrigger value="admin" className="px-2 sm:px-3">
                                    <Shield className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.admin || "User Management"}</span>
                                </TabsTrigger>
                            </>
                        )}
                        <TabsTrigger value="danger" className="px-2 sm:px-3">
                            <AlertTriangle className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.danger || "Danger"}</span>
                        </TabsTrigger>
                        <TabsTrigger value="about" className="px-2 sm:px-3">
                            <Info className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.about || "About"}</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* General Tab */}
                    <TabsContent value="general" className="space-y-4 py-4">
                        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                            <div className="space-y-2">
                                <Label>{t.settings?.language || "Language"}</Label>
                                <Select
                                    value={language}
                                    onValueChange={(val: 'zh' | 'en') => setLanguage(val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="zh">中文 (Chinese)</SelectItem>
                                        <SelectItem value="en">English</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2 pt-4 border-t">
                                <Label>{t.settings?.general?.timeoutLabel || "AI Analysis Timeout (Seconds)"}</Label>
                                <Input
                                    type="number"
                                    value={config.timeouts?.analyze ? config.timeouts.analyze / 1000 : ''}
                                    onChange={(e) => {
                                        const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                                        // Allow typing, validate later
                                        setConfig(prev => ({
                                            ...prev,
                                            timeouts: {
                                                ...prev.timeouts,
                                                analyze: isNaN(val) ? 0 : val * 1000
                                            }
                                        }));
                                    }}
                                    onBlur={() => {
                                        const currentVal = (config.timeouts?.analyze || 0) / 1000;
                                        // Valid range 120-600, default 120
                                        let safeVal = currentVal;
                                        if (safeVal < 120) safeVal = 120;
                                        if (safeVal > 600) safeVal = 600;

                                        if (safeVal !== currentVal) {
                                            setConfig(prev => ({
                                                ...prev,
                                                timeouts: {
                                                    ...prev.timeouts,
                                                    analyze: safeVal * 1000
                                                }
                                            }));
                                        }
                                    }}
                                    min={120}
                                    max={600}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t.settings?.general?.timeoutDesc || "Increase this value if you experience frequent timeouts during AI analysis."}
                                </p>
                            </div>
                        </div>
                        <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t.settings?.save || "Save Settings"}
                        </Button>
                    </TabsContent>

                    {/* Account Tab */}
                    <TabsContent value="account" className="space-y-4 py-4">
                        {profileLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>{t.auth?.name || "Name"}</Label>
                                        <Input
                                            value={profile.name || ""}
                                            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t.auth?.email || "Email"}</Label>
                                        <Input
                                            value={profile.email || ""}
                                            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                            type="email"
                                        />
                                        <p className="text-xs text-muted-foreground">{language === 'zh' ? '修改邮箱后，所有已登录会话失效，请用新邮箱重新登录。' : 'Changing your email signs out all sessions. Sign in again with the new email.'}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>{t.auth?.educationStage || "Education Stage"}</Label>
                                        <Select
                                            value={profile.educationStage || ""}
                                            onValueChange={(val) => setProfile({ ...profile, educationStage: val })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={t.auth?.selectStage || "Select Stage"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="primary">{t.auth?.primary || 'Primary School'}</SelectItem>
                                                <SelectItem value="junior_high">{t.auth?.juniorHigh || 'Junior High'}</SelectItem>
                                                <SelectItem value="senior_high">{t.auth?.seniorHigh || 'Senior High'}</SelectItem>
                                                <SelectItem value="university">{t.auth?.university || 'University'}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t.auth?.enrollmentYear || "Enrollment Year"}</Label>
                                        <Input
                                            type="number"
                                            value={profile.enrollmentYear || ""}
                                            onChange={(e) => setProfile({ ...profile, enrollmentYear: e.target.value })}
                                            placeholder="YYYY"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2 border-t">
                                    <a className="underline" href="/change-password">{language === "zh" ? "修改密码（需验证当前密码）" : "Change password (current password required)"}</a>
                                </div>

                                <Button onClick={handleSaveProfile} disabled={profileSaving} className="w-full">
                                    {profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t.settings?.account?.update || "Update Profile"}
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    {/* AI Tab */}
                    <TabsContent value="ai" className="space-y-4 py-4">
                        <p>AI配置已升级为持久化多供应商配置。旧设置首次使用时自动迁移，后续请在新页面管理。</p>
                        {session?.user?.role === "admin" && <a className="underline" href="/admin/ai">管理站点AI配置、模型顺序与导入</a>}
                        <p><a className="underline" href="/ai-settings">管理我的AI与私有配置</a></p>
                        <p><a className="underline" href="/ai-tasks">查看我的AI任务</a></p>
                    </TabsContent>

                    <TabsContent value="prompts" className="space-y-4 py-4">
                        <PromptSettings config={config} onUpdate={updatePrompts} />
                        <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t.settings?.prompts?.save || "Save Prompt Settings"}
                        </Button>
                    </TabsContent>

                    {/* Admin Tab */}
                    {
                        (session?.user as any)?.role === 'admin' && (
                            <TabsContent value="admin" className="space-y-4 py-4">
                                <Button
                                    variant="outline"
                                    className="w-full justify-start gap-2"
                                    onClick={() => {
                                        setOpen(false)
                                        router.push("/admin")
                                    }}
                                >
                                    <BarChart3 className="h-4 w-4" />
                                    {t.admin?.dashboard?.title || "Admin Dashboard"}
                                </Button>
                                <div className="border-t pt-4">
                                    <a className="block mb-4 underline" href="/admin/announcements">{language === "en" ? "Announcement management" : "公告管理"}</a>
                                    <UserManagement />
                                </div>
                            </TabsContent>
                        )
                    }

                    {/* Danger Zone Tab */}
                    <TabsContent value="danger" className="space-y-4 py-4">
                        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm space-y-2">
                            <h3 className="font-semibold">{language === "en" ? "Record retention and backup boundaries" : "记录保留与备份范围"}</h3>
                            <p>{language === "en" ? "Solving conversations and direct solves are retained long-term, separately from notebook entries. The controls below do not provide a complete AI-record cleanup." : "解题会话与直接解题长期保留，独立于错题收录。以下按钮不提供完整的AI记录清理。"}</p>
                            <p>{language === "en" ? "For a full backup, stop writes and back up the database, configuration directory and original secret environment variables together. Keep the encryption master key. Notebook JSON exports cannot restore solving records." : "完整备份需先停止写入，将数据库、配置目录与原秘密环境变量配对保存，并保留加密主钥。错题本JSON导出无法恢复解题记录、公告或已阅状态。"}</p>
                        </div>
                        <div className="space-y-3">
                            {/* Data Management Section - Available to all users */}
                            <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
                                <h4 className="text-sm font-bold text-blue-900 mb-3">
                                    {t.settings?.dataManagement || "Data Management"}
                                </h4>

                                {/* Export */}
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-blue-800 font-medium">
                                            {t.settings?.exportData || "Export Data"}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleExportData}
                                                disabled={exporting}
                                                className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300"
                                            >
                                                {exporting ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Download className="mr-2 h-4 w-4" />
                                                )}
                                                {t.settings?.exportData || "Export"}
                                            </Button>
                                            {(session?.user as any)?.role === 'admin' && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleExportAllData}
                                                    disabled={exporting}
                                                    className="bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300"
                                                >
                                                    {exporting ? (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Download className="mr-2 h-4 w-4" />
                                                    )}
                                                    {t.settings?.exportAllData || "Export All"}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-blue-700">
                                        {t.settings?.exportDataDesc || "Export all data as JSON file."}
                                    </p>
                                </div>

                                {/* Import */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-blue-800 font-medium">
                                            {t.settings?.importData || "Import Data"}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="file"
                                                accept=".json"
                                                onChange={handleImportFileChange}
                                                className="hidden"
                                                id="import-file-input"
                                                disabled={importing}
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => document.getElementById('import-file-input')?.click()}
                                                disabled={importing}
                                                className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300"
                                            >
                                                {importing ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Upload className="mr-2 h-4 w-4" />
                                                )}
                                                {selectedFileName || t.settings?.selectFile || "Select File"}
                                            </Button>
                                            {selectedFile && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleImportData}
                                                    disabled={importing}
                                                    className="bg-green-100 hover:bg-green-200 text-green-900 border-green-300"
                                                >
                                                    {importing ? (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                                    )}
                                                    {t.settings?.importData || "Import"}
                                                </Button>
                                            )}
                                            {selectedFile && (session?.user as any)?.role === 'admin' && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleImportAllData}
                                                    disabled={importing}
                                                    className="bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300"
                                                >
                                                    {importing ? (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                                    )}
                                                    {t.settings?.importAllData || "Import All"}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-blue-700">
                                        {t.settings?.importDataDesc || "Import data from JSON file. Existing data will be skipped."}
                                    </p>
                                </div>
                            </div>

                            {/* Migrate Tags (Admin Only) */}
                            {(session?.user as any)?.role === 'admin' && (
                                <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-sm text-blue-900 font-bold flex items-center gap-2">
                                                <RefreshCw className="h-4 w-4" />
                                                {t.settings?.migrateTags || "Migrate Tags"}
                                            </span>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleMigrateTags}
                                            disabled={migratingTags}
                                            className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300"
                                        >
                                            {migratingTags ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-blue-800 mt-2 font-medium">
                                        {t.settings?.migrateTagsDesc || 'Re-populates standard tags from file'}
                                    </p>
                                </div>
                            )}

                            {/* Clear Practice Data */}
                            <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-red-700 font-medium">
                                        {t.settings?.clearData || "Clear Practice Data"}
                                    </span>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleClearData}
                                        disabled={clearingPractice}
                                    >
                                        {clearingPractice ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                                <p className="text-xs text-red-600 mt-2">
                                    {t.settings?.clearDataDesc || 'This will permanently delete all practice history. Irreversible.'}
                                </p>
                            </div>

                            {/* Clear Error Data */}
                            <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-red-700 font-medium">
                                        {t.settings?.clearErrorData || "Clear Error Data"}
                                    </span>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleClearErrorData}
                                        disabled={clearingError}
                                    >
                                        {clearingError ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                                <p className="text-xs text-red-600 mt-2">
                                    {t.settings?.clearErrorDataDesc || 'This will permanently delete all error items. Irreversible.'}
                                </p>
                            </div>

                            {/* System Reset (Admin Only) */}
                            {(session?.user as any)?.role === 'admin' && (
                                <>
                                    {/* System Reset */}
                                    <div className="p-4 border border-red-600/50 rounded-lg bg-red-100/50">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-sm text-red-900 font-bold flex items-center gap-2">
                                                    <AlertTriangle className="h-4 w-4" />
                                                    {t.settings?.systemReset || "System Initialization"}
                                                </span>
                                            </div>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={handleSystemReset}
                                                disabled={systemResetting}
                                                className="bg-red-700 hover:bg-red-800"
                                            >
                                                {systemResetting ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                        <p className="text-xs text-red-800 mt-2 font-medium">
                                            {t.settings?.systemResetDesc || 'Resets the system to factory state. Deletes ALL data.'}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </TabsContent>

                    {/* About Tab */}
                    <TabsContent value="about" className="space-y-4 py-4">
                        <div className="flex flex-col items-center justify-center space-y-6 py-8 text-center bg-muted/30 rounded-lg border">
                            <div className="space-y-2">
                                <h3 className="text-2xl font-bold">{t.app?.title || "Smart Error Notebook"}</h3>
                                <p className="text-muted-foreground">
                                    {t.settings?.about?.desc || "AI-powered learning assistant"}
                                </p>
                            </div>

                            <div className="flex items-center space-x-2 text-sm text-muted-foreground border px-4 py-2 rounded-full bg-background">
                                <Info className="h-4 w-4" />
                                <span>{t.settings?.about?.version || "Version"}: v{version || "unknown"}</span>
                            </div>

                            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4 w-full sm:w-auto px-4 sm:px-0">
                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href={APP_REPOSITORY} target="_blank" rel="noopener noreferrer">
                                        <Github className="h-4 w-4" />
                                        {t.settings?.about?.github || "GitHub Repository"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>

                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href={APP_CHANGELOG} target="_blank" rel="noopener noreferrer">
                                        <ScrollText className="h-4 w-4" />
                                        {t.settings?.about?.releaseNotes || "Release Notes"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>

                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href={APP_ISSUES} target="_blank" rel="noopener noreferrer">
                                        <MessageSquareText className="h-4 w-4" />
                                        {t.settings?.about?.feedback || "Feedback"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>
                            </div>

                            <p className="text-xs text-muted-foreground px-4">{language === "en" ? "This is the version running on this instance, not a guarantee that a GitHub release or container image is published. When reporting issues, include steps and redacted diagnostics; never include keys or private questions." : "版本号表示当前实例运行的程序，不代表GitHub发行包或镜像已经发布。反馈时请附复现步骤及脱敏诊断，不上传密钥或私人题目。"}</p>
                            <a className="text-sm underline" href={APP_UPSTREAM} target="_blank" rel="noopener noreferrer">{language === "en" ? "Upstream project · wttwins/wrong-notebook" : "上游项目 · wttwins/wrong-notebook"}</a>
                            <p className="text-xs text-muted-foreground mt-8">
                                {t.settings?.about?.copyright || "© 2025 Wttwins. All rights reserved."}
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

