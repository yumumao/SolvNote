"use client";
import { AIWorkProgress } from "./ai-work-progress";
import { diagnosticMessage } from "@/lib/ai/diagnostics";
import type { DialogueMessage, ProcessStep } from "@/lib/ai-dialogue/types";
const stages:Record<string,string>={illustration_describe:"原图配图描述（不解题）",illustration:"MiniMax创作配图",geometry_check:"关键角标局部核对",construction:"辅助线构造",image_edit:"AI辅助线改图",recognize:"识图转录",solve:"解题",reread:"定向补读/核图",review:"独立复核"};
const states:Record<string,string>={running:"进行中",success:"完成",failed:"失败",unknown:"状态不确定，未自动重发",cancelled:"已取消"};
export function AIProcess({steps,messages,active=false}:{steps:ProcessStep[];messages:DialogueMessage[];active?:boolean}){
    // Never animate an older running snapshot after a newer attempt has ended.
    const latest=steps.reduce<ProcessStep|undefined>((last,step)=>!last||new Date(step.startedAt).getTime()>=new Date(last.startedAt).getTime()?step:last,undefined);
    const events=[...steps.map((s,i)=>({key:s.id || `step-${i}`,at:s.startedAt,step:s,message:null})),
        ...messages.filter(m=>m.kind!=="answer").map(m=>({key:m.id,at:m.at,step:null,message:m}))]
        .sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
    return <details className="border rounded-lg p-4" open><summary className="font-semibold cursor-pointer">AI处理过程（{steps.length}次尝试）</summary>
        <p className="text-xs text-muted-foreground my-2">展示执行尝试，不是模型内部思维链；失败和补读计入尝试预算，发送前被拒绝不代表AI已收到请求或已经计费。</p>
        <ol className="space-y-3 text-sm">{events.map(e=><li key={e.key} className="border-l-2 pl-3 break-words">
            <time className="text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</time>{e.step?<>
                <p>{e.step.round && `第${e.step.round}轮 · `}<strong>{stages[e.step.stage || ""] || "AI处理"}</strong> · {states[e.step.state] || e.step.state}</p>
                <p>{e.step.modelName || e.step.modelId}（{e.step.model || "历史模型"}） · 所属连接：{e.step.providerName || "历史记录无快照"}</p>
                <p>{e.step.errorCode==="AI_ENDPOINT_REJECTED"?(e.step.withImage?"含图请求未发送":"文字请求未发送"):(e.step.withImage?"已附图":"仅文字")} · {e.step.finishedAt?`${Math.max(0,(new Date(e.step.finishedAt).getTime()-new Date(e.step.startedAt).getTime())/1000).toFixed(1)}秒`:"等待完成"}{e.step.errorCode && ` · ${e.step.errorCode}`}</p>
                {e.step.errorCode==="AI_ENDPOINT_REJECTED" && <p className="text-amber-700">发送前被地址安全校验拒绝：请检查公网HTTPS地址、DNS是否返回内网或代理虚拟IP，以及服务器出口设置；这不是模型识图超时。</p>}
                {diagnosticMessage(e.step.diagnostic) ? <p className="text-amber-700">{diagnosticMessage(e.step.diagnostic)}</p>
                    : e.step.errorCode === "AI_RESPONSE_ERROR" ? <p className="text-amber-700">本次记录未记录细分原因，不能仅凭此错误码判断是模型不可用、空回复还是格式问题。</p>
                    : e.step.errorCode === "AI_ACCEPTANCE_UNKNOWN" ? <p className="text-amber-700">本次记录未记录细分原因，无法确认服务端是否完成，系统不会自动重发。</p> : null}
                <AIWorkProgress compact active={active&&e.step===latest&&e.step.state==="running"&&!e.step.finishedAt} label={stages[e.step.stage || ""] || "AI处理"}/>
                {!!e.step.detailImageCount && <p>附加原图局部：{e.step.detailImageCount}张</p>}
                {!!e.step.questions?.length && <p>本次核对：{e.step.questions.join("；")}</p>}
            </>:<p>{e.message?.kind==="notice"?"系统提示":"人工输入"} · 第{e.message?.round}轮：{e.message?.text}</p>}
        </li>)}</ol>{!events.length && <p>尚未调用AI。</p>}
    </details>;
}
