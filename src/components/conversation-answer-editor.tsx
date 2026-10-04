"use client";
import {useEffect, useRef, useState, type ComponentProps} from "react";
import {useRouter} from "next/navigation";
import {apiClient} from "@/lib/api-client";
import type {DialogueView} from "@/lib/ai-dialogue/types";
import type {ParsedQuestion} from "@/lib/ai";
import {CorrectionEditor} from "./correction-editor";
import {drawingEvidenceFromDialogue} from "@/lib/ai-drawing/evidence";
import {Button} from "./ui/button";
export type AnswerSnapshot = Pick<DialogueView,"revision"|"input"|"transcript"|"geometryChecked"|"userCorrectedTranscript"|"transcriptClarifications"> & {result:ParsedQuestion};
function fingerprint(s:AnswerSnapshot) { return JSON.stringify([s.result,s.input.originalImageBase64 || s.input.imageBase64,s.input.subjectId,drawingEvidenceFromDialogue(s)]); }

/** A paired result/image snapshot: polling and later AI rounds must not replace a human draft. */
export function ConversationAnswerEditor({id,snapshot,expectedSubjectId}:{id:string;snapshot:AnswerSnapshot;expectedSubjectId?:string}) {
    const router=useRouter();
    const [draft,setDraft]=useState(snapshot),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
    const operation=useRef(false),saved=useRef(false);
    const hasNewAnswer=fingerprint(draft)!==fingerprint(snapshot);
    useEffect(()=>{
        const handler=(e:BeforeUnloadEvent)=>{if(!saved.current){e.preventDefault();e.returnValue="";}};
        window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);
    },[]);
    async function replace(){
        if(operation.current || !window.confirm("采用新回复会替换尚未保存的编辑内容和演示。会话历史仍保留；确认替换吗？"))return;
        operation.current=true;setBusy(true);setMessage("");
        try {
            const fresh=await apiClient.get<DialogueView>(`/api/ai/conversations/${encodeURIComponent(id)}?restore=1`);
            if(fresh.id!==id || fresh.state!=="answered" || !fresh.result || fresh.revision!==snapshot.revision || (expectedSubjectId && fresh.input.subjectId && fresh.input.subjectId!==expectedSubjectId)) {
                setMessage("会话状态已变化，请刷新核对；未覆盖编辑内容。");return;
            }
            setDraft({result:fresh.result,input:fresh.input,revision:fresh.revision,transcript:fresh.transcript,geometryChecked:fresh.geometryChecked,userCorrectedTranscript:fresh.userCorrectedTranscript,transcriptClarifications:fresh.transcriptClarifications});setVersion(v=>v+1);saved.current=false;
        } catch {setMessage("无法确认新回复，未覆盖编辑内容。请刷新核对。");}
        finally {operation.current=false;setBusy(false);}
    }
    const save:ComponentProps<typeof CorrectionEditor>["onSave"]=async data=>{
        if(operation.current)return;
        operation.current=true;setBusy(true);setMessage("");
        try {
            const subjectId=expectedSubjectId || data.subjectId;
            if(!subjectId){setMessage("请先选择要保存的错题本。");return;}
            await apiClient.post("/api/error-items",{...data,subjectId,originalImageUrl:draft.input.originalImageBase64 || draft.input.imageBase64 || ""});
            saved.current=true;router.push(`/notebooks/${encodeURIComponent(subjectId)}`);
        } catch {setMessage("未确认保存成功，编辑内容仍保留。请先到错题本核对，避免重复添加。");}
        finally {operation.current=false;setBusy(false);}
    };
    return <section aria-label="直接编辑并添加错题" className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">核对、编辑并添加到错题本</h3>
        <p className="text-sm text-muted-foreground">无需另行取回。可直接改作答状态、错误解答、错因和知识点；题干、答案、解析默认预览，展开标记代码即可修改。会话历史已保存，但这里的手动编辑需点击保存才会写入错题本。</p>
        {hasNewAnswer && <aside className="border rounded p-3 space-y-2"><p>已有新的AI回复，当前人工编辑保留不变。可先查看历史回复，再决定是否替换。</p><Button variant="outline" disabled={busy} onClick={()=>void replace()}>采用新回复替换编辑内容</Button></aside>}
        {message && <p role="alert">{message}</p>}
        <fieldset disabled={busy} className="min-w-0">
            <CorrectionEditor drawingEvidence={drawingEvidenceFromDialogue(draft)} key={version} initialData={draft.result} initialSubjectId={expectedSubjectId || draft.input.subjectId}
                imagePreview={draft.input.originalImageBase64 || draft.input.imageBase64 || null} onSave={save}
                onCancel={()=>{if(window.confirm("会话历史已保存；尚未添加到错题本的编辑将丢失，确认返回首页吗？"))router.push("/");}}/>
        </fieldset>
    </section>;
}
