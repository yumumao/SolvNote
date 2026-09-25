"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/api-client";
import type { DialogueView } from "@/lib/ai-dialogue/types";
import { ConversationAnswerEditor, type AnswerSnapshot } from "./conversation-answer-editor";
import { processImageFile } from "@/lib/image-utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { QuestionResultPreview, readQuestionResult } from "./question-result-preview";
import { GeometryEvidence } from "./geometry-evidence";
import { AIProcess } from "./ai-process";
import { Button } from "./ui/button";
export const dialogueLabels:Record<string,string>={active:"排队/AI处理中",awaiting_user:"等待你补充信息",answered:"本轮已完成",failed:"本轮停止，可检查后继续",unknown:"上游状态不确定，禁止自动重发",cancelling:"正在取消",cancelled:"已取消"};
const errors:Record<string,string>={DIALOGUE_CONFLICT:"状态已更新，请刷新后重新操作。",DIALOGUE_ROUND_LIMIT:"问答轮数已用完。管理员可确认后扩额。",DIALOGUE_CALL_LIMIT:"本轮AI调用或活动时间已用完。可先保存补充条件，管理员确认扩额后再继续。",DIALOGUE_UNKNOWN:"上游可能已受理，请先核查供应商计费记录；不会自动重发。",DIALOGUE_BUSY:"任务仍在执行，请等它完成或先取消。",ORIGIN_REJECTED:"页面地址与服务端正式地址不一致，请检查NEXTAUTH_URL并重新登录。",FORBIDDEN:"当前账户无权限。",DIALOGUE_CONTEXT_LIMIT:"上下文已达上限，请保存已有结果。"};
function errorText(e:unknown){const code=e instanceof ApiError?(e.data as {message?:string})?.message:undefined;return errors[code || ""] || "操作未确认成功，请先刷新核对，避免重复提交。";}
export function AIConversation({id,expectedSubjectId}:{id:string;expectedSubjectId?:string}){
    const router=useRouter();
    const operation=useRef(false);
    const [answerSnapshot,setAnswerSnapshot]=useState<AnswerSnapshot>();
    const [original,setOriginal]=useState<string>();
    const [view,setView]=useState<DialogueView|null>(null),[error,setError]=useState(""),[text,setText]=useState(""),[image,setImage]=useState<string>(),[busy,setBusy]=useState(false),[reading,setReading]=useState(false);
    const inFlight=useRef(false),generation=useRef(0),first=useRef(true),viewRef=useRef<DialogueView|null>(null);
    const url=`/api/ai/conversations/${encodeURIComponent(id)}`;
    const reload=useCallback(async()=>{
        if(inFlight.current)return;inFlight.current=true;
        const gen=generation.current;
        try{
            const restored=first.current;
            let c=await apiClient.get<DialogueView>(`${url}${restored?"?restore=1":""}`);
            // A completed answer must be paired with current full-resolution pixels, including cross-tab edits.
            if(!restored && c.state==="answered" && c.result)c=await apiClient.get<DialogueView>(`${url}?restore=1`);
            if(gen!==generation.current)return;
            if(viewRef.current?.id===c.id && viewRef.current.revision>c.revision)return;
            first.current=false;
            if(c.state==="answered" && c.result && c.id===id)setAnswerSnapshot({result:c.result,input:c.input,revision:c.revision});
            setView(old=>{if(old && old.id===c.id && old.revision>c.revision)return old;
                const merged={...c,input:{...old?.input,...c.input}};viewRef.current=merged;return merged;});setError("");
        }catch(e){if(gen===generation.current)setError(errorText(e));}finally{inFlight.current=false;}
    },[url,id]);
    useEffect(()=>{
        const gen=++generation.current;first.current=true;viewRef.current=null;
        const start=setTimeout(()=>{setView(null);setAnswerSnapshot(undefined);void reload();},0);
        const timer=setInterval(()=>{if(!viewRef.current || ["active","cancelling"].includes(viewRef.current.state))void reload();},2000);
        return()=>{generation.current=gen+1;clearTimeout(start);clearInterval(timer);};
    },[reload]);
    async function act(kind:string,amount?:number,correction?:{correctedTranscript:string;revision:number}){
        if(!view || operation.current || reading)return;
        if(kind==="extend_rounds" && !window.confirm("追加5轮问答？后续调用可能产生费用，扩额不会立即调用AI。"))return;
        if(kind==="extend_budget" && !window.confirm("当前轮追加4次AI调用和10分钟活动时间？可能增加费用，扩额后仍需手动继续。"))return;
        if(kind==="cancel" && !window.confirm("取消当前轮？不能保证撤销上游已受理请求或退费，取消后不能直接续发本轮。"))return;
        operation.current=true;setBusy(true);setError("");
        try{
            const include=["save","continue","ask"].includes(kind);
            await apiClient.post(url,{kind,revision:view.revision,...(correction?correction:include?{text,...(image?{imageBase64:image,originalImageBase64:original || image}:{})}:{}),...(amount?{amount}:{})});
            if(include && !correction){if(image)first.current=true;setText("");setImage(undefined);setOriginal(undefined);}await reload();return true;
        }catch(e){setError(errorText(e));}finally{operation.current=false;setBusy(false);}
    }
    async function upload(file?:File){
        if(!file)return;
        if(file.size>8*1024*1024 || !["image/png","image/jpeg","image/webp"].includes(file.type)){setError("请选择8MiB以内的PNG/JPEG/WebP图片。");return;}
        setReading(true);try{const raw=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(new Error());reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);});setImage(await processImageFile(file));setOriginal(raw);setError("");}catch{setError("图片处理失败。");}finally{setReading(false);}
    }
    async function remove(){
        if(!view || operation.current || !window.confirm("永久删除此会话的题图、问答和AI调用记录？已存入错题本的题目不受影响。"))return;
        operation.current=true;setBusy(true);
        try{await apiClient.delete(url,{body:JSON.stringify({revision:view.revision})});router.push("/ai-tasks");}
        catch(e){setError(errorText(e));}finally{operation.current=false;setBusy(false);}
    }
    if(!view)return <section className="border rounded p-4"><p role="status">{error || "正在恢复解题会话…"}</p><Button variant="outline" onClick={()=>void reload()}>重新读取</Button></section>;
    const active=["active","cancelling"].includes(view.state),locked=["unknown","cancelled"].includes(view.state);
    const exhausted=view.roundAttempts>=view.attemptLimit || view.roundElapsedMs>=view.timeLimitMs;
    const wrongNotebook=!!(expectedSubjectId && view.input.subjectId && expectedSubjectId!==view.input.subjectId);
    const messages = view.messages.map(message => ({ message, result: message.kind === "answer" ? readQuestionResult(message.text) : undefined }));


    return <section className="space-y-4" aria-label="同题解题会话">
        <header className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <h2 className="text-lg font-semibold">{dialogueLabels[view.state] || view.state}</h2>
            <p>已完成{view.roundsUsed}/{view.roundLimit}轮 · 当前轮调用{view.roundAttempts}/{view.attemptLimit}次 · 已结算活动时间{Math.ceil(view.roundElapsedMs/1000)}/{view.timeLimitMs/1000}秒</p>
            <p className="text-sm text-muted-foreground">首次答案计1轮，澄清和补图不另扣轮数。等待你回复不占AI队列或活动时间。每轮最多1次自动补读回环。</p>
            <div className="flex flex-wrap gap-4 text-sm"><Link className="underline" href="/" onClick={e=>{if(answerSnapshot && !window.confirm("会话和AI回复已保存，可从我的AI任务恢复；编辑区尚未保存的修改不会保留。确认返回首页吗？"))e.preventDefault();}}>返回首页</Link><Link className="underline" href={`/ai-dialogue/${id}`}>独立会话页</Link><Link className="underline" href="/ai-tasks">我的AI任务</Link><button className="underline" disabled={busy} onClick={()=>void reload()}>刷新状态</button></div>
        </header>
        {wrongNotebook && <p role="alert">此会话属于其他错题本，请从独立会话页返回原错题本编辑器。</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {view.errorCode && <p className="border rounded p-3">本轮停止原因：{view.errorCode}。{view.state==="unknown"?"请求可能已收费，请先核对供应商记录，不会自动重发。":"已保留转录和调用记录；继续会消耗本轮剩余预算。"}</p>}
        {messages.map(({message:m,result})=>result ? <details key={m.id} className="p-4 rounded-lg border bg-muted/20">
            <summary className="cursor-pointer text-sm">第{m.round}轮 · AI回复（历史快照，点击查看）</summary><QuestionResultPreview result={result}/>
        </details> : <article key={m.id} className="p-4 rounded-lg border">
            <h3 className="text-xs text-muted-foreground mb-3">第{m.round}轮 · {m.kind==="answer"?"AI回复":m.kind==="notice"?"提示/待确认":"你的输入"}</h3><MarkdownRenderer content={m.text}/>
        </article>)}
        {view.transcript && <GeometryEvidence transcript={view.transcript} image={view.input.originalImageBase64||view.input.imageBase64} revision={view.revision} corrected={view.userCorrectedTranscript} verified={view.geometryChecked} disabled={busy||active||locked||reading||wrongNotebook} answered={view.state==="answered"} onCorrect={async(value,revision,saveOnly)=>{if(!saveOnly&&!window.confirm(view.state==="answered"?"采用完整修订并重新解题？将计新一轮，可能产生费用。":"采用完整修订并继续当前轮？可能产生AI调用费用。"))return false;return act(saveOnly?"save":view.state==="answered"?"ask":"continue",undefined,{correctedTranscript:value,revision});}}/>}
        {answerSnapshot && !wrongNotebook && <ConversationAnswerEditor key={id} id={id} snapshot={answerSnapshot} expectedSubjectId={expectedSubjectId}/>}
        {!!view.questions.length && <aside className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30"><h3 className="font-semibold">请核对或补充</h3><ul className="list-disc pl-5">{view.questions.map((q,i)=><li key={i}>{q}</li>)}</ul><p className="text-sm mt-2">可以直接回答，不一定要再调用识图模型。补图将替换当前题图，请提供完整条件。</p></aside>}
        {!active && !locked && <div className="space-y-3 border rounded-lg p-4">
            <label className="block">{view.state==="answered"?"继续追问":"补充条件/纠正转录"}<textarea className="w-full min-h-24 border rounded p-2 bg-background" value={text} onChange={e=>setText(e.target.value)} maxLength={10000} disabled={busy || reading}/></label>
            <label className="block text-sm">补充完整题图（可选）<input className="block mt-1" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || reading} onChange={e=>void upload(e.target.files?.[0])}/></label>
            {image && <p className="text-sm">已选择新图，提交后替换旧图并重新转录。<button className="underline ml-2" onClick={()=>setImage(undefined)}>移除待提交图片</button></p>}
            <div className="flex flex-wrap gap-2">
                {view.state==="answered"?<Button disabled={busy || reading || !text.trim() || view.roundsUsed>=view.roundLimit} onClick={()=>void act("ask")}>发送追问（新一轮）</Button>:<>
                    <Button variant="outline" disabled={busy || reading || (!text.trim()&&!image)} onClick={()=>void act("save")}>仅保存补充，不调用AI</Button>
                    <Button disabled={busy || reading || exhausted} onClick={()=>void act("continue")}>继续当前轮</Button>
                </>}
            </div>
            {exhausted && view.roundOpen && <p>本轮调用或时间额度耗尽，可先保存补充条件；管理员确认扩额后才能继续。</p>}
            {view.roundsUsed>=view.roundLimit && !view.roundOpen && <p>已到问答轮数上限，管理员可明确确认后增加额度。</p>}
        </div>}
        <div className="flex flex-wrap gap-2">
            {!active && <Button variant="outline" disabled={busy} onClick={()=>void remove()}>删除会话</Button>}
            {active && <Button variant="outline" disabled={busy || view.state==="cancelling"} onClick={()=>void act("cancel")}>取消当前轮</Button>}
            {view.isAdmin && !active && !locked && <>
                {view.roundLimit<=95 && <Button variant="outline" disabled={busy} onClick={()=>void act("extend_rounds",5)}>管理员：增加5轮</Button>}
                {view.roundOpen && view.attemptLimit<=14 && view.timeLimitMs<=1200000 && <Button variant="outline" disabled={busy} onClick={()=>void act("extend_budget")}>管理员：本轮增加调用预算</Button>}
            </>}
        </div>
        <AIProcess steps={view.steps} messages={view.messages}/>
    </section>;
}
