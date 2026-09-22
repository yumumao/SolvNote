"use client";

import { useState, Suspense, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ParsedQuestion } from "@/lib/ai";
import { UserWelcome } from "@/components/user-welcome";
import { apiClient, ApiError, waitForAIJob } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, AppConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { Upload, BookOpen, Tags, LogOut, BarChart3, PenLine } from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import { BroadcastNotification } from "@/components/broadcast-notification";
import { signOut } from "next-auth/react";

import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { TextInputZone } from "@/components/text-input-zone";
import { DirectTextEditor } from "@/components/direct-text-editor";

type RestorableAnalyzeJob = {
    kind: string;
    state: string;
    result?: AnalyzeResponse;
    input?: {
        subjectId?: string;
        imageBase64?: string;
        originalImageBase64?: string;
        questionText?: string;
        mode?: "direct" | "transcribe" | "text";
        review?: boolean;
    };
};

const taskStateLabels: Record<string, string> = {
    pending: "排队中", running: "AI处理中", success: "已完成",
    failed: "失败", cancelled: "已取消", unknown: "受理状态不确定，请先核查，不要重复提交",
};

function HomeContent() {
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const { t, language } = useLanguage();
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialNotebookId = searchParams.get("notebook");
    const [notebooks, setNotebooks] = useState<{ id: string; name: string }[]>([]);
    const [autoSelectedNotebookId, setAutoSelectedNotebookId] = useState<string | null>(null);

    const inferredNotebookId = parsedData?.subject
        ? notebooks.find(n => n.name.includes(parsedData.subject) || parsedData.subject.includes(n.name))?.id
        : undefined;
    const selectedNotebookId = initialNotebookId || autoSelectedNotebookId || inferredNotebookId;

    const [config, setConfig] = useState<AppConfig | null>(null);

    // Input mode: "image" for photo upload, "text" for AI solve, "direct" for manual entry
    const [inputMode, setInputMode] = useState<"image" | "text" | "direct">("image");

    // Cropper state
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);

    const [extraText, setExtraText] = useState("");
    const [aiMode, setAiMode] = useState<"direct" | "transcribe">("direct");
    const [review, setReview] = useState(false);
    const [taskStatus, setTaskStatus] = useState("");
    const [taskId, setTaskId] = useState<string | null>(null);
    const activeRequest = useRef<AbortController | null>(null);
    const restoreJobId = searchParams.get("job");

    // Only bounds an individual HTTP request. The durable queue owns the AI deadline.
    const aiTimeout = config?.timeouts?.analyze || 180000;

    // Cleanup Blob URL to prevent memory leak
    useEffect(() => {
        return () => {
            if (croppingImage) {
                URL.revokeObjectURL(croppingImage);
            }
        };
    }, [croppingImage]);

    useEffect(() => {
        // Fetch notebooks for auto-selection
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(data => setNotebooks(data))
            .catch(err => console.error("Failed to fetch notebooks:", err));

        // Fetch settings for timeouts
        apiClient.get<AppConfig>("/api/settings")
            .then(data => {
                setConfig(data);
                if (data.timeouts?.analyze) {
                    frontendLogger.info('[Config]', 'Loaded timeout settings', {
                        analyze: data.timeouts.analyze
                    });
                }
            })
            .catch(err => console.error("Failed to fetch config:", err));
    }, []);

    const showAnalysis = useCallback((result: AnalyzeResponse | undefined, image: string | null, subjectId?: string) => {
        if (!result || typeof result.questionText !== "string" || typeof result.answerText !== "string") {
            throw new Error("INVALID_ANALYSIS_RESULT");
        }
        setParsedData(result);
        setCurrentImage(image);
        setAutoSelectedNotebookId(subjectId || null);
        setStep("review");
    }, []);

    useEffect(() => {
        const listener = (event: Event) => {
            if (!activeRequest.current || activeRequest.current.signal.aborted) return;
            const detail = (event as CustomEvent<{ id?: string; state?: string }>).detail;
            if (!detail?.id || !detail.state) return;
            setTaskId(detail.id);
            setTaskStatus(`任务${detail.id}：${taskStateLabels[detail.state] || detail.state}`);
        };
        window.addEventListener("ai-job-progress", listener);
        return () => {
            window.removeEventListener("ai-job-progress", listener);
            // Stop only local polling. Never cancel the server job on navigation.
            activeRequest.current?.abort();
        };
    }, []);

    useEffect(() => {
        if (!restoreJobId) return;
        const controller = new AbortController();
        activeRequest.current?.abort();
        activeRequest.current = controller;
        setAnalysisStep("analyzing");
        setStep("upload");
        setParsedData(null);
        setCurrentImage(null);
        setTaskId(restoreJobId);
        setTaskStatus("正在取回任务，请勿重复提交。");
        const restore = async () => {
            try {
                // The endpoint authenticates the session and checks job ownership.
                // Neither localStorage nor query parameters are trusted as result data.
                const job = await apiClient.get<RestorableAnalyzeJob>(`/api/ai/jobs/${encodeURIComponent(restoreJobId)}?restore=1`, { signal: controller.signal });
                if (controller.signal.aborted) return;
                if (job.kind !== "analyze" || !job.input) {
                    setTaskStatus("此任务不能恢复到主页编辑器，请到我的AI任务查看。");
                    return;
                }
                let result = job.result;
                if (job.state === "pending" || job.state === "running") {
                    result = await waitForAIJob<AnalyzeResponse>(restoreJobId, controller.signal);
                } else if (job.state !== "success") {
                    setTaskStatus(`任务${taskStateLabels[job.state] || "不可恢复"}，请到我的AI任务查看，不要连续重复提交。`);
                    return;
                }
                if (controller.signal.aborted) return;
                showAnalysis(result, job.input.originalImageBase64 || job.input.imageBase64 || null, job.input.subjectId);
                setInputMode(job.input.mode === "text" ? "text" : "image");
                setExtraText(job.input.questionText || "");
                setAiMode(job.input.mode === "transcribe" ? "transcribe" : "direct");
                setReview(Boolean(job.input.review));
                setTaskStatus("已取回任务结果，请核对原图与AI结果后保存。");
            } catch {
                if (!controller.signal.aborted) setTaskStatus("任务不存在、不可访问、已过期或暂时无法取回，请到我的AI任务查看。");
            } finally {
                if (activeRequest.current === controller) {
                    activeRequest.current = null;
                    if (!controller.signal.aborted) setAnalysisStep("idle");
                }
            }
        };
        void restore();
        return () => {
            controller.abort();
            // A query-only navigation can keep Home mounted. Unlock its form too.
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                setAnalysisStep("idle");
                setTaskStatus("已停止本页等待，后台任务仍可在我的AI任务查看。");
            }
        };
    }, [restoreJobId, showAnalysis]);

    const onImageSelect = (file: File) => {
        if (activeRequest.current) return;
        const imageUrl = URL.createObjectURL(file);
        setCroppingImage(imageUrl);
        setIsCropperOpen(true);
    };

    const handleCropComplete = (croppedBlob: Blob) => {
        setIsCropperOpen(false);
        const file = new File([croppedBlob], "cropped-image.jpg", { type: croppedBlob.type || "image/jpeg" });
        void handleAnalyze(file);
    };

    const handleAnalyze = async (file: File) => {
        if (activeRequest.current) return;
        if (file.size > 8 * 1024 * 1024) {
            alert("裁剪图片超过8MiB，请缩小裁剪范围。");
            return;
        }
        const controller = new AbortController();
        activeRequest.current = controller;
        setTaskId(null);
        setTaskStatus("");
        try {
            setAnalysisStep("compressing");
            const originalImage = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
                reader.readAsDataURL(file);
            });
            const base64Image = await processImageFile(file);
            if (controller.signal.aborted) return;
            setAnalysisStep("analyzing");
            setTaskStatus("正在提交任务，受理后可离开页面，稍后到我的AI任务取回。");
            const result = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                originalImageBase64: originalImage,
                questionText: extraText,
                mode: aiMode,
                review,
                language,
                subjectId: initialNotebookId || undefined,
            }, { timeout: aiTimeout, signal: controller.signal });
            if (controller.signal.aborted) return;
            showAnalysis(result, originalImage, initialNotebookId || undefined);
        } catch {
            if (!controller.signal.aborted) {
                setTaskStatus("解题未完成，请到我的AI任务查看详情；离开或刷新不会取消后台任务，不要连续重复提交。");
                alert(t.common?.messages?.analysisFailed || "解题未完成，请到我的AI任务查看详情。");
            }
        } finally {
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                if (!controller.signal.aborted) setAnalysisStep("idle");
            }
        }
    };

    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string }): Promise<void> => {
        frontendLogger.info('[HomeSave]', 'Starting save process', {
            hasQuestionText: !!finalData.questionText,
            hasAnswerText: !!finalData.answerText,
            subjectId: finalData.subjectId,
            knowledgePointsCount: finalData.knowledgePoints?.length || 0,
            hasImage: !!currentImage,
            imageSize: currentImage?.length || 0,
        });

        try {
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
            });

            // 检查是否是重复提交（后端去重返回）
            if (result.duplicate) {
                frontendLogger.info('[HomeSave]', 'Duplicate submission detected, using existing record');
            }

            frontendLogger.info('[HomeSave]', 'Save successful');
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
            alert(t.common?.messages?.saveSuccess || 'Saved successfully!');

            // Redirect to notebook page if subjectId is present
            if (finalData.subjectId) {
                router.push(`/notebooks/${finalData.subjectId}`);
            }
        } catch (error: unknown) {
            frontendLogger.error('[HomeSave]', 'Save failed', {
                errorStatus: error instanceof ApiError ? error.status : undefined,
            });
            alert(t.common?.messages?.saveFailed || 'Failed to save');
        }
    };

    const handleTextSubmit = async (questionText: string) => {
        if (activeRequest.current || !questionText.trim()) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        setTaskId(null);
        setTaskStatus("正在提交文字解题任务，请勿重复提交。");
        try {
            setAnalysisStep("analyzing");
            const result = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                questionText,
                mode: "text",
                review,
                language,
                subjectId: initialNotebookId || undefined,
            }, { timeout: aiTimeout, signal: controller.signal });
            if (controller.signal.aborted) return;
            showAnalysis(result, null, initialNotebookId || undefined);
        } catch {
            if (!controller.signal.aborted) {
                setTaskStatus("解题未完成，请到我的AI任务查看详情；不要连续重复提交。");
                alert(t.common?.messages?.analysisFailed || "解题未完成，请到我的AI任务查看详情。");
            }
        } finally {
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                if (!controller.signal.aborted) setAnalysisStep("idle");
            }
        }
    };

    const handleDirectSave = async (data: {
        questionText: string;
        answerText: string;
        analysis: string;
        wrongAnswerText: string;
        mistakeAnalysis: string;
        mistakeStatus: string;
        knowledgePoints: string[];
        subjectId: string;
        gradeSemester?: string;
        paperLevel?: string;
    }): Promise<void> => {
        frontendLogger.info('[HomeDirectSave]', 'Starting direct save', {
            hasQuestionText: !!data.questionText,
            hasAnswerText: !!data.answerText,
            subjectId: data.subjectId,
        });

        try {
            setAnalysisStep('saving');
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                questionText: data.questionText,
                answerText: data.answerText,
                analysis: data.analysis,
                wrongAnswerText: data.wrongAnswerText || null,
                mistakeAnalysis: data.mistakeAnalysis || null,
                mistakeStatus: data.mistakeStatus || "unknown",
                knowledgePoints: data.knowledgePoints,
                subjectId: data.subjectId,
                gradeSemester: data.gradeSemester,
                paperLevel: data.paperLevel,
                originalImageUrl: "",
            });

            if (result.duplicate) {
                frontendLogger.info('[HomeDirectSave]', 'Duplicate detected');
            }

            frontendLogger.info('[HomeDirectSave]', 'Save successful');
            setAnalysisStep('idle');
            alert(t.common?.messages?.saveSuccess || 'Saved successfully!');

            if (data.subjectId) {
                router.push(`/notebooks/${data.subjectId}`);
            }
        } catch (error: unknown) {
            frontendLogger.error('[HomeDirectSave]', 'Save failed', {
                errorStatus: error instanceof ApiError ? error.status : undefined,
            });
            setAnalysisStep('idle');
            alert(t.common?.messages?.saveFailed || 'Failed to save');
        }
    };

    const getProgressMessage = () => {
        switch (analysisStep) {
            case 'compressing': return t.common.progress?.compressing || "Compressing...";
            case 'uploading': return t.common.progress?.uploading || "Uploading...";
            case 'analyzing': return t.common.progress?.analyzing || "Analyzing...";
            case 'processing': return t.common.progress?.processing || "Processing...";
            case 'saving': return "保存中...";
            default: return "";
        }
    };

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback
                status={analysisStep === "analyzing" ? "idle" : analysisStep}
                message={getProgressMessage()}
            />

            <div className="container mx-auto p-4 space-y-8 pb-20">
                {/* Header Section */}
                <div className="flex justify-between items-start gap-4">
                    <UserWelcome />

                    <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm shrink-0">
                        <BroadcastNotification />
                        <SettingsDialog />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full text-muted-foreground hover:text-destructive"
                            onClick={() => signOut({ callbackUrl: '/login' })}
                            title={t.app?.logout || 'Logout'}
                        >
                            <LogOut className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                {/* Action Center */}
                <div className={initialNotebookId ? "flex justify-center mb-6" : "grid grid-cols-2 md:grid-cols-4 gap-4"}>
                    <Button
                        size="lg"
                        className={`h-auto py-4 text-base shadow-sm hover:shadow-md transition-all ${initialNotebookId ? "w-full max-w-md" : ""}`}
                        variant={step === "upload" ? "default" : "secondary"}
                        disabled={analysisStep !== "idle"}
                        onClick={() => { setStep("upload"); setInputMode("image"); }}
                    >
                        <div className="flex items-center gap-2">
                            <Upload className="h-5 w-5" />
                            <span>{t.app.uploadNew}</span>
                        </div>
                    </Button>

                    {!initialNotebookId && (
                        <>
                            <Link href="/notebooks" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="h-5 w-5" />
                                        <span>{t.app.viewNotebook}</span>
                                    </div>
                                </Button>
                            </Link>

                            <Link href="/tags" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <Tags className="h-5 w-5" />
                                        <span>{t.app?.tags || 'Tags'}</span>
                                    </div>
                                </Button>
                            </Link>

                            <Link href="/stats" className="w-full">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-full h-auto py-4 text-base shadow-sm hover:shadow-md transition-all border hover:border-primary/50 hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="h-5 w-5" />
                                        <span>{t.app?.stats || 'Stats'}</span>
                                    </div>
                                </Button>
                            </Link>
                        </>
                    )}
                </div>

                <section className="border rounded p-3 space-y-2" aria-label="AI任务状态">
                    <div className="flex flex-wrap gap-4">
                        <Link className="underline" href="/ai-tasks">我的AI任务（取回结果/取消）</Link>
                        {taskId && <Link className="underline" href={`/?job=${encodeURIComponent(taskId)}`}>恢复本次任务</Link>}
                    </div>
                    <p role="status">{taskStatus}</p>
                    <p className="text-sm">受理后的任务在后台继续运行，刷新或离开页面不等于取消。结果仅保留24小时，请及时取回。</p>
                    <p className="text-sm">年级是讲解偏好，不是解题限制，正确性优先。请核对图形标注与AI结果。</p>
                </section>

                {step === "upload" && (
                    <div className="space-y-4">
                        {inputMode !== "direct" && (
                            <label className="block">
                                <input type="checkbox" checked={review} disabled={analysisStep !== "idle"} onChange={e => setReview(e.target.checked)} />
                                第二个AI独立复核（需链中至少两个可用模型，增加费用）
                            </label>
                        )}
                        {/* Input mode tabs */}
                        <div className="flex gap-2 border-b">
                            <button
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "image"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                disabled={analysisStep !== "idle"}
                                onClick={() => setInputMode("image")}
                            >
                                <Upload className="h-4 w-4" />
                                {t.app?.uploadImage || "拍照上传"}
                            </button>
                            <button
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "text"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                disabled={analysisStep !== "idle"}
                                onClick={() => setInputMode("text")}
                            >
                                <PenLine className="h-4 w-4" />
                                {t.app?.manualInput || "AI解题"}
                            </button>
                            <button
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    inputMode === "direct"
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                                disabled={analysisStep !== "idle"}
                                onClick={() => setInputMode("direct")}
                            >
                                <PenLine className="h-4 w-4" />
                                直接录入
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <div className="space-y-3">
                                <label className="block">图片处理方式
                                    <select className="border rounded p-2 ml-2 bg-background" value={aiMode} disabled={analysisStep !== "idle"} onChange={e => setAiMode(e.target.value as "direct" | "transcribe")}>
                                        <option value="direct">直接发图＋补充文字解题</option>
                                        <option value="transcribe">先AI转录，再带原图解题（增加一次调用）</option>
                                    </select>
                                </label>
                                <textarea className="w-full border rounded p-2 bg-background" aria-label="图片补充文字" placeholder="可选：补充题目文字、看不清的标注或你的疑问。图形仍会传给AI。" value={extraText} disabled={analysisStep !== "idle"} onChange={e => setExtraText(e.target.value)} />
                                <p className="text-sm text-muted-foreground">裁剪后的原图最多8MiB，将保留供核对和保存；另传压缩副本用于解题。</p>
                                <UploadZone onImageSelect={onImageSelect} isAnalyzing={analysisStep !== 'idle'} />
                            </div>
                        ) : inputMode === "text" ? (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={
                                    selectedNotebookId
                                        ? notebooks.find(n => n.id === selectedNotebookId)?.name
                                        : undefined
                                }
                            />
                        ) : (
                            <DirectTextEditor
                                onSubmit={handleDirectSave}
                                defaultNotebookId={selectedNotebookId || undefined}
                                defaultNotebookName={
                                    selectedNotebookId
                                        ? notebooks.find(n => n.id === selectedNotebookId)?.name
                                        : undefined
                                }
                                isSaving={analysisStep === 'saving'}
                            />
                        )}
                    </div>
                )}

                {croppingImage && (
                    <ImageCropper
                        imageSrc={croppingImage}
                        open={isCropperOpen}
                        onClose={() => setIsCropperOpen(false)}
                        onCropComplete={handleCropComplete}
                    />
                )}

                {step === "review" && parsedData && (
                    <CorrectionEditor
                        initialData={parsedData}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        imagePreview={currentImage}
                        initialSubjectId={selectedNotebookId || undefined}
                        aiTimeout={aiTimeout}
                    />
                )}

            </div>
        </main>
    );
}

export default function Home() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <HomeContent />
        </Suspense>
    );
}
