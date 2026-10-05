"use client";
import {memo, useCallback, useEffect, useRef, useState, type ComponentProps} from "react";
import {useRouter} from "next/navigation";
import {apiClient} from "@/lib/api-client";
import type {DialogueView} from "@/lib/ai-dialogue/types";
import type {ParsedQuestion} from "@/lib/ai";
import {CorrectionEditor} from "./correction-editor";
import {drawingEvidenceFromDialogue} from "@/lib/ai-drawing/evidence";
import {createBaseDrawingCache,type BaseDrawingCache} from "@/lib/ai-drawing/base-reuse";
export type AnswerSnapshot = Pick<DialogueView,"revision"|"input"|"transcript"|"geometryChecked"|"userCorrectedTranscript"|"transcriptClarifications"> & {result:ParsedQuestion};
function fingerprint(s:AnswerSnapshot) { return JSON.stringify([s.result,s.input.originalImageBase64 || s.input.imageBase64,s.input.subjectId,drawingEvidenceFromDialogue(s)]); }

/** Stable keyed editors isolate local edits and late drawing responses by solution version. */
export function ConversationAnswerEditor({id,snapshot,expectedSubjectId}:{id:string;snapshot:AnswerSnapshot;expectedSubjectId?:string}) {
    const [versions,setVersions]=useState([{snapshot,version:0}]);
    const [baseDrawingCache]=useState(createBaseDrawingCache);
    const current=versions[0];
    if(snapshot.revision>=current.snapshot.revision) {
        if(fingerprint(snapshot)!==fingerprint(current.snapshot)) {
            // Never use draft/drawing activity as a lock on the latest solution.
            // Keep the old component mounted in collapsed history instead.
            setVersions([{snapshot,version:current.version+1},...versions]);
        } else if(snapshot.revision>current.snapshot.revision) {
            setVersions([{...current,snapshot},...versions.slice(1)]);
        }
    }
    return <section aria-label="直接编辑并添加错题" className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">核对、编辑并添加到错题本</h3>
        <p className="text-sm text-muted-foreground">新题解会自动接管这里的编辑和作图功能，旧题解及本页的手动编辑、作图保留在下方折叠区。仅解释细节不会替换题解。会话历史已保存；手动编辑和生成的图需添加到错题本，刷新或离开页面不会保留这些本地内容。</p>
        {current.version>0 && <p role="status" className="text-sm text-muted-foreground">当前为最新题解。原题条件未变时，点击第一步可复用本页已有底图，无需再次调用AI；仍需核对并锁定。辅助线图需按新解法手动重绘，不会自动调用AI。旧作图即使稍后完成，也不会自动替换当前图。</p>}
        {versions.map((entry,index)=><AnswerVersion key={`${id}:${entry.version}`} snapshot={entry.snapshot} version={entry.version} active={index===0} baseDrawingCache={baseDrawingCache} expectedSubjectId={expectedSubjectId}/>)}
    </section>;
}

const AnswerVersion=memo(function AnswerVersion({snapshot:draft,version,active,baseDrawingCache,expectedSubjectId}:{snapshot:AnswerSnapshot;version:number;active:boolean;baseDrawingCache:BaseDrawingCache;expectedSubjectId?:string}) {
    const router=useRouter();
    const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[expanded,setExpanded]=useState(false);
    const operation=useRef(false),saved=useRef(false),isCurrent=useRef(active);
    useEffect(()=>{isCurrent.current=active;},[active]);
    const protectDraft=useCallback(()=>{saved.current=false;},[]);
    useEffect(()=>{
        if(!active)return;
        const handler=(e:BeforeUnloadEvent)=>{if(!saved.current){e.preventDefault();e.returnValue="";}};
        window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);
    },[active]);
    const save:ComponentProps<typeof CorrectionEditor>["onSave"]=async data=>{
        if(!isCurrent.current || operation.current)return;
        operation.current=true;setBusy(true);setMessage("");
        try {
            const subjectId=expectedSubjectId || data.subjectId;
            if(!subjectId){setMessage("请先选择要保存的错题本。");return;}
            await apiClient.post("/api/error-items",{...data,subjectId,originalImageUrl:draft.input.originalImageBase64 || draft.input.imageBase64 || ""});
            saved.current=true;
            // A completed old save must not navigate away from a newly adopted answer.
            if(isCurrent.current)router.push(`/notebooks/${encodeURIComponent(subjectId)}`);
            else setMessage("旧题解已保存到错题本，当前新题解未受影响。");
        } catch {setMessage("未确认保存成功，编辑内容仍保留。请先到错题本核对，避免重复添加。");}
        finally {operation.current=false;setBusy(false);}
    };
    return <details open={active||expanded} onToggle={e=>{if(!active)setExpanded(e.currentTarget.open);}} data-answer-version={version} data-current-answer={active?"true":"false"} className={active?"min-w-0":"min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60 [&_[data-slot=card]]:bg-transparent"}>
        <summary className={active?"hidden":"cursor-pointer text-sm"}>旧题解与本地编辑（版本{version+1}，点击展开）</summary>
        {!active && <p className="text-sm text-muted-foreground my-2">此处只读保留旧版，作图和保存请使用上方最新题解。旧版尚在进行的作图完成后仍显示在此处。</p>}
        {message && <p role="status">{message}</p>}
        <fieldset disabled={busy||!active} className="min-w-0">
            <CorrectionEditor baseDrawingCache={baseDrawingCache} baseDrawingVersion={version} onDraftChange={protectDraft} drawingEvidence={drawingEvidenceFromDialogue(draft)} initialData={draft.result} initialSubjectId={expectedSubjectId || draft.input.subjectId}
                imagePreview={draft.input.originalImageBase64 || draft.input.imageBase64 || null} onSave={save}
                onCancel={()=>{if(isCurrent.current && window.confirm("会话历史已保存；尚未添加到错题本的编辑将丢失，确认返回首页吗？"))router.push("/");}}/>
        </fieldset>
    </details>;
});
