"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ParsedQuestion } from "@/lib/ai";
import { apiClient, waitForAIJob } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, AppConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { ArrowLeft, Upload, PenLine } from "lucide-react";
import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { TextInputZone } from "@/components/text-input-zone";

type RestorableAnalyzeJob = {
    kind: string;
    state: string;
    result?: AnalyzeResponse;
    input?: {
        subjectId?: string;
        originalImageBase64?: string;
        imageBase64?: string;
        questionText?: string;
        mode?: "direct" | "transcribe" | "text";
        review?: boolean;
    };
};

const taskStateLabels: Record<string, string> = {
    pending: "排队中", running: "AI处理中", success: "已完成",
    failed: "失败", cancelled: "已取消", unknown: "受理状态不确定，请先核查，不要重复提交",
};

function AddErrorContent({ notebookId }: { notebookId: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const restoreJobId = searchParams.get("job");
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>("idle");
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const { t, language } = useLanguage();
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [extraText, setExtraText] = useState("");
    const [aiMode, setAiMode] = useState<"direct" | "transcribe">("direct");
    const [review, setReview] = useState(false);
    const [taskStatus, setTaskStatus] = useState("");
    const [taskId, setTaskId] = useState<string | null>(null);
    const [inputMode, setInputMode] = useState<"image" | "text">("image");
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const activeRequest = useRef<AbortController | null>(null);

    // Bounds a single HTTP request, never the lifetime of an accepted AI job.
    const aiTimeout = config?.timeouts?.analyze || 180000;

    useEffect(() => () => {
        if (croppingImage) URL.revokeObjectURL(croppingImage);
    }, [croppingImage]);

    useEffect(() => {
        const controller = new AbortController();
        apiClient.get<Notebook>(`/api/notebooks/${encodeURIComponent(notebookId)}`, { signal: controller.signal })
            .then(data => { if (!controller.signal.aborted) setNotebook(data); })
            .catch(() => { if (!controller.signal.aborted) router.push("/notebooks"); });
        apiClient.get<AppConfig>("/api/settings", { signal: controller.signal })
            .then(data => { if (!controller.signal.aborted) setConfig(data); })
            .catch(() => { /* Keep the local HTTP timeout default, never log response bodies. */ });
        return () => controller.abort();
    }, [notebookId, router]);

    const showAnalysis = useCallback((result: AnalyzeResponse | undefined, image: string | null) => {
        if (!result || typeof result.questionText !== "string" || typeof result.answerText !== "string"
            || typeof result.analysis !== "string" || typeof result.subject !== "string"
            || !Array.isArray(result.knowledgePoints) || !result.knowledgePoints.every(point => typeof point === "string")) {
            throw new Error("INVALID_ANALYSIS_RESULT");
        }
        setParsedData(result);
        setCurrentImage(image);
        setStep("review");
    }, []);

    useEffect(() => {
        const listener = (event: Event) => {
            if (!activeRequest.current || activeRequest.current.signal.aborted) return;
            const detail = (event as CustomEvent<{ id?: unknown; state?: unknown }>).detail;
            if (typeof detail?.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(detail.id) || typeof detail.state !== "string") return;
            setTaskId(detail.id);
            setTaskStatus(`任务${detail.id}：${taskStateLabels[detail.state] || "未知状态，请到我的AI任务查看"}`);
        };
        window.addEventListener("ai-job-progress", listener);
        return () => {
            window.removeEventListener("ai-job-progress", listener);
            // Stop only local work/polling. Never DELETE/cancel a server job here.
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
                // The server authenticates the owner; notebook affinity is an additional check.
                const job = await apiClient.get<RestorableAnalyzeJob>(`/api/ai/jobs/${encodeURIComponent(restoreJobId)}?restore=1`, { signal: controller.signal });
                if (controller.signal.aborted) return;
                if (job.kind !== "analyze" || !job.input || job.input.subjectId !== notebookId) {
                    setTaskStatus("此任务不是当前错题本的解题任务，请到我的AI任务选择正确的恢复入口。");
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
                showAnalysis(result, job.input.originalImageBase64 || job.input.imageBase64 || null);
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
            // Query-only navigation may retain the component: unlock its form.
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                setAnalysisStep("idle");
                setTaskStatus("已停止本页等待，后台任务仍可在我的AI任务查看。");
            }
        };
    }, [restoreJobId, notebookId, showAnalysis]);

    const onImageSelect = (file: File) => {
        if (activeRequest.current) return;
        setCroppingImage(URL.createObjectURL(file));
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
        try {
            setAnalysisStep("compressing");
            const originalImage = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("IMAGE_READ_FAILED"));
                reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
                reader.readAsDataURL(file);
            });
            if (controller.signal.aborted) return;
            const imageBase64 = await processImageFile(file);
            if (controller.signal.aborted) return;
            setAnalysisStep("analyzing");
            setTaskStatus("正在提交任务，受理后可离开页面，稍后到我的AI任务取回。");
            const result = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64, originalImageBase64: originalImage, questionText: extraText,
                mode: aiMode, review, language, subjectId: notebookId,
            }, { timeout: aiTimeout, signal: controller.signal });
            if (controller.signal.aborted) return;
            showAnalysis(result, originalImage);
        } catch {
            if (!controller.signal.aborted) {
                setTaskStatus("解题未完成，请到我的AI任务查看详情；刷新或离开不会取消后台任务，不要连续重复提交。");
                alert(t.common.messages?.analysisFailed || "解题未完成，请到我的AI任务查看详情。");
            }
        } finally {
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                if (!controller.signal.aborted) setAnalysisStep("idle");
            }
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
                questionText, language, subjectId: notebookId, mode: "text", review,
            }, { timeout: aiTimeout, signal: controller.signal });
            if (controller.signal.aborted) return;
            showAnalysis(result, null);
        } catch {
            if (!controller.signal.aborted) {
                setTaskStatus("解题未完成，请到我的AI任务查看详情；不要连续重复提交。");
                alert(t.common.messages?.analysisFailed || "解题未完成，请到我的AI任务查看详情。");
            }
        } finally {
            if (activeRequest.current === controller) {
                activeRequest.current = null;
                if (!controller.signal.aborted) setAnalysisStep("idle");
            }
        }
    };

    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string; gradeSemester?: string; paperLevel?: string }): Promise<void> => {
        try {
            await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage || "",
                subjectId: notebookId,
            });

            alert(t.common.messages?.saveSuccess || 'Saved!');
            router.push(`/notebooks/${notebookId}`);
        } catch {
            alert(t.common.messages?.saveFailed || 'Save failed');
        }
    };

    const getProgressMessage = () => {
        switch (analysisStep) {
            case 'compressing': return t.common.progress?.compressing || "Compressing...";
            case 'uploading': return t.common.progress?.uploading || "Uploading...";
            case 'analyzing': return t.common.progress?.analyzing || "Analyzing...";
            case 'processing': return t.common.progress?.processing || "Processing...";
            default: return "";
        }
    };

    if (!notebook) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback
                status={analysisStep === "analyzing" ? "idle" : analysisStep}
                progress={0}
                message={getProgressMessage()}
            />

            <div className="container mx-auto p-4 space-y-8 pb-20">
                {/* Header Section */}
                <div className="flex items-center gap-4">
                    <Link href={`/notebooks/${notebookId}`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">{t.app.addError}</h1>
                </div>

                <div className="border rounded p-3 space-y-2" aria-label="AI任务状态">
                    <Link className="underline" href="/ai-tasks">我的AI任务（刷新后取回结果/取消）</Link>
                    <p role="status">{taskStatus}</p>
                    {taskId && <Link className="block underline" href={`/notebooks/${encodeURIComponent(notebookId)}/add?job=${encodeURIComponent(taskId)}`}>恢复本次任务</Link>}
                    <p className="text-sm">受理后的任务在后台继续运行，刷新或离开不等于取消。结果仅保留24小时，请及时取回。</p>
                    <p className="text-sm">年级是讲解偏好，不是解题限制。请核对图形标注与AI结果。</p>
                </div>
                {/* Main Content */}
                {step === "upload" && (
                    <div className="space-y-4">
                        <label className="block"><input type="checkbox" checked={review} disabled={analysisStep !== "idle"} onChange={e=>setReview(e.target.checked)} />第二个AI独立复核（需链中至少两个可用模型，增加费用）</label>
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
                                {t.app?.manualInput || "手动输入"}
                            </button>
                        </div>

                        {inputMode === "image" ? (
                            <div className="space-y-3">
                                <label className="block">图片处理方式<select className="border rounded p-2 ml-2 bg-background" value={aiMode} disabled={analysisStep !== "idle"} onChange={e=>setAiMode(e.target.value as "direct"|"transcribe")}><option value="direct">直接发图＋补充文字解题</option><option value="transcribe">先AI转录，再带原图解题（增加一次调用）</option></select></label>
                                <textarea className="w-full border rounded p-2 bg-background" aria-label="图片补充文字" placeholder="可选：补充题目文字、看不清的标注或你的疑问。图形仍会传给AI。" value={extraText} disabled={analysisStep !== "idle"} onChange={e=>setExtraText(e.target.value)} />
                                <UploadZone onImageSelect={onImageSelect} isAnalyzing={analysisStep !== 'idle'} />
                            </div>
                        ) : (
                            <TextInputZone
                                onSubmit={handleTextSubmit}
                                isAnalyzing={analysisStep !== 'idle'}
                                defaultNotebookName={notebook?.name}
                            />
                        )}
                    </div>
                )}

                {step === "review" && parsedData && (
                    <CorrectionEditor
                        initialData={parsedData}
                        imagePreview={currentImage}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        initialSubjectId={notebookId}
                        aiTimeout={aiTimeout}
                    />
                )}
            </div>

            <ImageCropper
                imageSrc={croppingImage || ""}
                open={isCropperOpen}
                onClose={() => setIsCropperOpen(false)}
                onCropComplete={handleCropComplete}
            />
        </main>
    );
}

export default function AddErrorPage() {
    const params = useParams<{ id: string }>();
    // Query recovery needs a Suspense boundary; changing notebooks must abort
    // the previous local request and discard its editor state, not its AI job.
    return (
        <Suspense fallback={<p className="p-4">加载中…</p>}>
            <AddErrorContent key={params.id} notebookId={params.id} />
        </Suspense>
    );
}
