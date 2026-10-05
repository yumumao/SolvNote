"use client";

import { useState, useEffect, useRef, type SetStateAction } from "react";
import Link from "next/link";
import { ParsedQuestion } from "@/lib/ai";
import { calculateGrade } from "@/lib/grade-calculator";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, RefreshCw, Loader2, Box } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { MarkdownField } from "@/components/markdown-field";
import { TagInput } from "@/components/tag-input";
import { NotebookSelector } from "@/components/notebook-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { UserProfile, Notebook } from "@/types/api";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave, type MistakeStatus } from "@/lib/mistake-status";
import type { ReanswerQuestionResult, GeogebraAnalysisResult } from "@/lib/ai/types";
import { buildReanswerRequestBody } from "@/lib/reanswer-request";
import {currentDrawingAttachments,type DrawingShareState} from "@/lib/solution-snapshot";
import { AuxiliaryDrawing } from "@/components/auxiliary-drawing";
import { GeogebraDemo } from "@/components/geogebra-demo";

interface ParsedQuestionWithSubject extends ParsedQuestion {
    subjectId?: string;
    gradeSemester?: string;
    paperLevel?: string;
    geogebraCommands?: string;
}

interface CorrectionEditorProps {
    baseDrawingCache?: import("@/lib/ai-drawing/base-reuse").BaseDrawingCache;
    baseDrawingVersion?: number;
    /** Only local edits/actions protect a conversation draft; initialization does not. */
    onDraftChange?: () => void;
    drawingEvidence?: import("@/lib/ai-drawing/evidence").DrawingEvidence;
    initialData: ParsedQuestion;
    onSave: (data: ParsedQuestionWithSubject) => Promise<void>;
    onCancel: () => void;
    imagePreview?: string | null;
    initialSubjectId?: string;
    aiTimeout?: number;
}

type ReanswerErrorMessages = {
    default?: string;
    authError?: string;
    connectionFailed?: string;
    responseError?: string;
};

export function CorrectionEditor({ initialData, onSave, onCancel, imagePreview, initialSubjectId, aiTimeout, drawingEvidence, onDraftChange, baseDrawingCache, baseDrawingVersion }: CorrectionEditorProps) {
    const [data, setDataState] = useState<ParsedQuestionWithSubject>({
        ...initialData,
        wrongAnswerText: initialData.wrongAnswerText || "",
        mistakeAnalysis: initialData.mistakeAnalysis || "",
        mistakeStatus: initialData.mistakeStatus || "unknown",
        subjectId: initialSubjectId,
        gradeSemester: "",
        paperLevel: "a"
    });
    const setData = (update: SetStateAction<ParsedQuestionWithSubject>) => {
        onDraftChange?.();
        setDataState(update);
    };
    const [shareDrawings,setShareDrawings]=useState<DrawingShareState|null>(null);
    const drawingAttachments=currentDrawingAttachments(shareDrawings,data.questionText,data.answerText,data.analysis,imagePreview);
    const { t, language } = useLanguage();
    const [isReanswering, setIsReanswering] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isAnalyzingGeogebra, setIsAnalyzingGeogebra] = useState(false);
    const [geogebraError, setGeogebraError] = useState<string | null>(null);
    const [review, setReview] = useState(false);
    const [taskStatus, setTaskStatus] = useState("");
    const reanswerRequest = useRef<AbortController | null>(null);
    const geogebraRequest = useRef<AbortController | null>(null);

    useEffect(() => {
        const listener = (event: Event) => {
            if (!reanswerRequest.current && !geogebraRequest.current) return;
            const detail = (event as CustomEvent<{ id?: string; state?: string }>).detail;
            if (!detail?.id || !detail.state) return;
            const labels: Record<string, string> = { pending: "排队中", running: "AI处理中", success: "已完成", failed: "失败", unknown: "受理状态不确定，请先核查", cancelled: "已取消" };
            setTaskStatus(`任务${detail.id}：${labels[detail.state] || detail.state}`);
        };
        window.addEventListener("ai-job-progress", listener);
        return () => {
            window.removeEventListener("ai-job-progress", listener);
            // Unmounting stops local polling, not the durable server job.
            reanswerRequest.current?.abort();
            geogebraRequest.current?.abort();
        };
    }, []);

    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);



    // Notebook inference may arrive after the result. Never overwrite a user's selection.
    useEffect(() => {
        if (initialSubjectId) setDataState(prev => prev.subjectId ? prev : { ...prev, subjectId: initialSubjectId });
    }, [initialSubjectId]);

    // Fetch user info and calculate grade on mount
    useEffect(() => {
        // Fetch notebooks for mapping
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch(err => console.error("Failed to fetch notebooks:", err));

        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                if (user && user.educationStage && user.enrollmentYear) {
                    const grade = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), language);
                    setDataState(prev => ({ ...prev, gradeSemester: grade }));
                    setEducationStage(user.educationStage);
                }
            })
            .catch(err => console.error("Failed to fetch user info for grade calculation:", err));
    }, [language]);

    // 重新解题函数
    const handleReanswer = async () => {
        if (!data.questionText.trim() && !imagePreview) {
            alert(t.editor.enterQuestionFirst || 'Please enter question text first');
            return;
        }

        if (reanswerRequest.current || geogebraRequest.current) return;
        onDraftChange?.(); // Protect pending paid work before an awaited response.
        const controller = new AbortController();
        reanswerRequest.current = controller;
        setTaskStatus("正在提交重解任务，请勿重复提交。");
        setIsReanswering(true);
        try {
            const requestBody = buildReanswerRequestBody({
                questionText: data.questionText,
                language,
                subject: data.subject,
                imagePreview,
                gradeSemester: data.gradeSemester,
            });

            frontendLogger.info('[Reanswer]', 'Sending request', { timeout: aiTimeout });

            const result = await apiClient.post<ReanswerQuestionResult>("/api/reanswer", {
                ...requestBody,
                subjectId: data.subjectId,
                originalImageBase64: imagePreview || undefined,
                review,
            }, { timeout: aiTimeout || 180000, signal: controller.signal });
            if (controller.signal.aborted) return;

            setData(prev => ({
                ...prev,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints,
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatusForSave(
                    result.mistakeStatus,
                    result.wrongAnswerText
                ),
            }));

            alert(t.editor.reanswerSuccess || '✅ Answer and analysis updated!');
        } catch (error: unknown) {
            if (controller.signal.aborted) return;
            setTaskStatus("重解未完成，请到我的AI任务查看；不要连续重复提交。");
            const apiError = error as { data?: { message?: string } };
            const msg = apiError.data?.message || '';

            const reanswerErrors: ReanswerErrorMessages = t.errors?.reanswer || {};
            let errorText = reanswerErrors.default || 'Reanswer failed';

            if (msg.includes('AI_AUTH_ERROR')) {
                errorText = reanswerErrors.authError || t.errors?.AI_AUTH_ERROR || errorText;
            } else if (msg.includes('AI_CONNECTION_FAILED')) {
                errorText = reanswerErrors.connectionFailed || t.errors?.AI_CONNECTION_FAILED || errorText;
            } else if (msg.includes('AI_RESPONSE_ERROR')) {
                errorText = reanswerErrors.responseError || t.errors?.AI_RESPONSE_ERROR || errorText;
            }

            alert(errorText);

        } finally {
            reanswerRequest.current = null;
            if (!controller.signal.aborted) setIsReanswering(false);
        }
    };

    const handleAnalyzeGeogebra = async () => {
        if (!data.questionText.trim() && !imagePreview) {
            alert(t.editor.enterQuestionFirst || '请先输入题目文本');
            return;
        }
        if (!data.answerText.trim()) {
            alert('请先生成或输入答案');
            return;
        }

        if (geogebraRequest.current || reanswerRequest.current) return;
        onDraftChange?.(); // Protect pending paid work before an awaited response.
        const controller = new AbortController();
        geogebraRequest.current = controller;
        setTaskStatus("正在提交GeoGebra任务，请勿重复提交。");
        setIsAnalyzingGeogebra(true);
        setGeogebraError(null);
        try {
            const result = await apiClient.post<GeogebraAnalysisResult>("/api/geogebra-analyze", {
                questionText: data.questionText,
                answerText: data.answerText,
                analysis: data.analysis,
                imageBase64: imagePreview || undefined,
                originalImageBase64: imagePreview || undefined,
                subjectId: data.subjectId,
                subject: data.subject,
                gradeSemester: data.gradeSemester,
                language,
            }, { timeout: aiTimeout || 180000, signal: controller.signal });
            if (controller.signal.aborted) return;
            if (result.suitable && result.commands?.length > 0) {
                setData(prev => ({
                    ...prev,
                    geogebraCommands: JSON.stringify(result.commands),
                }));
            } else {
                setGeogebraError(result.description || "该题目不适合用 GeoGebra 演示");
            }
        } catch {
            if (controller.signal.aborted) return;
            setTaskStatus("GeoGebra任务未完成，请到我的AI任务查看；不要连续重复提交。");
            setGeogebraError("分析未完成，请先到我的AI任务核查状态。");
        } finally {
            geogebraRequest.current = null;
            if (!controller.signal.aborted) setIsAnalyzingGeogebra(false);
        }
    };


    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.editor.title}</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        {t.editor.cancel}
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!data.subjectId) {
                                alert(t.editor.messages?.selectNotebook || "Please select a notebook");
                                return;
                            }
                            if (isSaving) return; // 防止重复点击
                            setIsSaving(true);
                            try {
                                await onSave({
                                    ...data,
                                    mistakeStatus: normalizeMistakeStatusForSave(
                                        data.mistakeStatus,
                                        data.wrongAnswerText
                                    ),
                                });
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                        disabled={isSaving || isReanswering || isAnalyzingGeogebra}
                    >
                        {isSaving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {isSaving ? (t.common?.pleaseWait || "Please wait...") : t.editor.save}
                    </Button>
                </div>
            </div>

            <div className="border rounded p-3 space-y-2">
                <Link className="underline" href="/ai-tasks">我的AI任务（取回结果/取消）</Link>
                <p role="status">{taskStatus}</p>
                <p className="text-sm">刷新或离开不会取消已受理的后台任务，请勿重复提交。年级仅作为讲解偏好，正确性优先。</p>
            </div>

            <div className="space-y-6">
                {/* 左侧：编辑区 */}
                <div className="space-y-6">
                    {imagePreview && (
                        <Card>
                            <CardContent className="p-4">
                                <img src={imagePreview} alt="Original" className="w-full rounded-md" />
                            </CardContent>
                        </Card>
                    )}

                    <div className="space-y-2">
                        <Label>{t.editor.selectNotebook || "Select Notebook"}</Label>
                        <NotebookSelector
                            value={data.subjectId}
                            onChange={(id) => setData({ ...data, subjectId: id })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t.editor.gradeSemester || "Grade/Semester"}</Label>
                            <Input
                                value={data.gradeSemester || ""}
                                onChange={(e) => setData({ ...data, gradeSemester: e.target.value })}
                                placeholder="e.g. Junior High Grade 1, 1st Semester"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t.editor.paperLevel || "Paper Level"}</Label>
                            <Select
                                value={data.paperLevel || "a"}
                                onValueChange={(val) => setData({ ...data, paperLevel: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="a">{t.editor.paperLevels?.a || "Paper A"}</SelectItem>
                                    <SelectItem value="b">{t.editor.paperLevels?.b || "Paper B"}</SelectItem>
                                    <SelectItem value="other">{t.editor.paperLevels?.other || "Other"}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <MarkdownField label={t.editor.question || "题目内容"} value={data.questionText || ""}
                            onChange={value => setData(prev => ({ ...prev, questionText: value }))} emptyText={"暂无题目内容"}/>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleReanswer}
                            disabled={isReanswering || isAnalyzingGeogebra || (!data.questionText.trim() && !imagePreview)}
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium"
                        >
                            {isReanswering ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t.editor.reanswering || 'AI solving...'}
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    {t.editor.reanswer || '🔄 Reanswer (based on corrected question)'}
                                </>
                            )}
                        </Button>
                        <label className="block text-sm">
                            <input type="checkbox" checked={review} disabled={isReanswering || isAnalyzingGeogebra} onChange={e => setReview(e.target.checked)} />
                            重解时由第二个AI独立复核（需至少两个可用模型，增加费用）
                        </label>
                        <p className="text-xs text-muted-foreground">
                            {t.editor.reanswerHint || '💡 If the question was misrecognized, correct it and click to regenerate answer'}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.tags}</Label>
                        <TagInput
                            value={data.knowledgePoints}
                            onChange={(tags) => setData({ ...data, knowledgePoints: tags })}
                            placeholder={t.editor.tagsPlaceholder || "Enter knowledge tags..."}
                            enterHint={t.editor.createTagHint}
                            subject={inferSubjectFromName(notebooks.find(n => n.id === data.subjectId)?.name || null) || inferSubjectFromName(data.subject || null) || undefined}
                            gradeStage={educationStage}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.editor.tagsHint || "💡 Tag suggestions will appear as you type"}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <MarkdownField readingControls label={t.editor.answer || "参考答案"} value={data.answerText || ""}
                            onChange={value => setData(prev => ({ ...prev, answerText: value }))} emptyText={"暂无参考答案"}/>
                    </div>

                    <div className="space-y-2">
                        <MarkdownField label={t.editor.analysis || "解题思路与步骤"} value={data.analysis || ""} shareContext={{questionText:data.questionText,answerText:data.answerText,originalImage:imagePreview,...drawingAttachments}}
                            onChange={value => setData(prev => ({ ...prev, analysis: value }))} emptyText={"暂无解析"}/>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t.editor.mistakeAnalysisTitle || "错因分析"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>{t.editor.mistakeStatus || "作答状态"}</Label>
                                <Select
                                    value={data.mistakeStatus || "unknown"}
                                    onValueChange={(val) => setData({ ...data, mistakeStatus: val as MistakeStatus })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="not_attempted">{t.editor.mistakeStatuses?.notAttempted || "不会做"}</SelectItem>
                                        <SelectItem value="wrong_attempt">{t.editor.mistakeStatuses?.wrongAttempt || "做错了"}</SelectItem>
                                        <SelectItem value="unknown">{t.editor.mistakeStatuses?.unknown || "未判断"}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="wrong-answer-evidence">{t.editor.wrongAnswerText || "错误解答原文"}</Label>
                                <Textarea id="wrong-answer-evidence" aria-label="错误解答原文" value={data.wrongAnswerText || ""}
                                    onChange={e => setData(prev => ({ ...prev, wrongAnswerText: e.target.value, mistakeStatus: e.target.value.trim() ? "wrong_attempt" : prev.mistakeStatus }))}
                                    className="min-h-[100px] font-mono text-sm" placeholder="填写原来的错误作答；不会做或未提供时可以留空"/>
                                {data.wrongAnswerText && <details><summary className="cursor-pointer text-sm">预览错误解答中的公式</summary><MarkdownRenderer content={data.wrongAnswerText}/></details>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="mistake-analysis-input">{t.editor.mistakeAnalysis || "错因分析"}</Label>
                                <Textarea id="mistake-analysis-input" aria-label="错因分析" value={data.mistakeAnalysis || ""}
                                    onChange={e => setData(prev => ({ ...prev, mistakeAnalysis: e.target.value }))}
                                    className="min-h-[140px] font-mono text-sm" placeholder="可直接填写或修改：错误发生在哪一步、原因、正确改法"/>
                                {data.mistakeAnalysis && <details><summary className="cursor-pointer text-sm">预览错因分析中的公式</summary><MarkdownRenderer content={data.mistakeAnalysis}/></details>}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {!!data.answerText.trim() && <div onClickCapture={onDraftChange} onChangeCapture={onDraftChange}><AuxiliaryDrawing baseDrawingCache={baseDrawingCache} baseDrawingVersion={baseDrawingVersion} drawingEvidence={data.questionText===initialData.questionText?drawingEvidence:undefined} onShareDrawings={setShareDrawings} questionText={data.questionText} answerText={data.answerText} analysis={data.analysis} image={imagePreview} disabled={isReanswering||isAnalyzingGeogebra} onUseCommands={commands=>setData(prev=>({...prev,geogebraCommands:commands}))}/></div>}
                {/* The preview and source now share each field; keep the existing durable GeoGebra action. */}
                <div id="geogebra-demo" className="space-y-6">
                    {/* GeoGebra Dynamic Demo */}
                    {data.geogebraCommands ? (
                        <GeogebraDemo commands={data.geogebraCommands} height={350} onRegenerate={handleAnalyzeGeogebra} />
                    ) : (data.questionText.trim() || imagePreview) && data.answerText.trim() ? (
                        <div className="rounded-lg border border-dashed p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Box className="h-4 w-4" />
                                    <span>GeoGebra 动态演示</span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleAnalyzeGeogebra}
                                    disabled={isAnalyzingGeogebra || isReanswering}
                                >
                                    {isAnalyzingGeogebra ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            AI 分析中...
                                        </>
                                    ) : (
                                        <>
                                            <Box className="mr-2 h-4 w-4" />
                                            生成演示
                                        </>
                                    )}
                                </Button>
                            </div>
                            {geogebraError && (
                                <p className="text-xs text-muted-foreground mt-2">{geogebraError}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                                AI 将判断本题是否可以用 GeoGebra 进行动态演示
                            </p>
                        </div>
                    ) : null}

                </div>
            </div>
        </div>
    );
}
