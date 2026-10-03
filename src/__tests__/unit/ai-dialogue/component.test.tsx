import { act } from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {DialogueView} from "@/lib/ai-dialogue/types";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),delete:vi.fn(),push:vi.fn()}));
vi.mock("@/lib/api-client",()=>({apiClient:mocks,ApiError:class extends Error{data:unknown;constructor(_status:unknown,_message:unknown,data:unknown){super();this.data=data;}}}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:mocks.push})}));
vi.mock("@/components/markdown-renderer",()=>({MarkdownRenderer:({content}:{content:string})=><div>{content}</div>}));
vi.mock("@/components/conversation-answer-editor",()=>({ConversationAnswerEditor:({snapshot}:{snapshot:{input:{originalImageBase64?:string;imageBase64?:string};result:{questionText:string}}})=><section data-testid="inline-editor" data-image={snapshot.input.originalImageBase64 || snapshot.input.imageBase64}>直接编辑并添加错题 {snapshot.result.questionText}</section>}));
import {AIConversation} from "@/components/ai-conversation";
let host:HTMLDivElement,root:Root,c:DialogueView;
const image="data:image/png;base64,YQ==";
const button=(name:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());};
const render=async(props:Partial<React.ComponentProps<typeof AIConversation>>={})=>{await act(async()=>{root.render(<AIConversation id="fixture" {...props}/>);});await act(async()=>{await vi.advanceTimersByTimeAsync(5);});};
const fill=async(text:string)=>{await act(async()=>{const t=host.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(t,text);t.dispatchEvent(new Event("input",{bubbles:true}));});};
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.useFakeTimers();vi.spyOn(window,"confirm").mockReturnValue(true);
 c={id:"fixture",state:"awaiting_user",revision:2,roundsUsed:0,roundLimit:10,roundOpen:true,roundAttempts:2,attemptLimit:6,roundElapsedMs:30,timeLimitMs:600000,isAdmin:false,activeJobId:"job",input:JobInputSchema.parse({questionText:"fixture",imageBase64:image,subjectId:"s"}),messages:[],questions:["length?"],steps:[{modelId:"t",modelName:"Text solver",providerName:"Test connection",model:"text",state:"success",stage:"solve",withImage:false,startedAt:new Date(0),finishedAt:new Date(1000)}],updatedAt:new Date()};
 mocks.get.mockImplementation(async()=>structuredClone(c));mocks.post.mockResolvedValue({ok:true});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
describe("conversation controls and process",()=>{
 it("shows real model/connection and lets the user save without dispatch",async()=>{await render();expect(host.textContent).toContain("Test connection");expect(host.textContent).toContain("Text solver");await fill("length 5");await click("仅保存补充，不调用AI");expect(mocks.post.mock.calls[0][1]).toEqual({kind:"save",revision:2,text:"length 5"});});
 it("does not poll while awaiting human input, and restores images only once",async()=>{await render();expect(mocks.get).toHaveBeenCalledWith("/api/ai/conversations/fixture?restore=1");await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});expect(mocks.get).toHaveBeenCalledTimes(1);await click("刷新状态");expect(mocks.get.mock.calls[1][0]).toBe("/api/ai/conversations/fixture");});
 it("polls active work and offers cancellation instead of another submission",async()=>{c.state="active";await render();expect(host.querySelector("textarea")).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(2200);});expect(mocks.get.mock.calls.length).toBeGreaterThan(1);await click("取消当前轮");expect(mocks.post.mock.calls[0][1].kind).toBe("cancel");});
 it("does not offer automatic continuation after unknown acceptance",async()=>{c.state="unknown";c.errorCode="AI_ACCEPTANCE_UNKNOWN";await render();expect(host.querySelector("textarea")).toBeNull();expect(button("继续当前轮")).toBeUndefined();expect(host.textContent).toContain("不会自动重发");expect(mocks.post).not.toHaveBeenCalled();});
 it("blocks spent budgets, but still allows saving human corrections",async()=>{c.roundAttempts=6;await render();expect(button("继续当前轮").disabled).toBe(true);await fill("new condition");expect(button("仅保存补充，不调用AI").disabled).toBe(false);expect(button("管理员：本轮增加调用预算")).toBeUndefined();});
 it("requires an explicit admin warning before extending budget",async()=>{c.isAdmin=true;c.roundAttempts=6;await render();vi.mocked(window.confirm).mockReturnValueOnce(false);await click("管理员：本轮增加调用预算");expect(mocks.post).not.toHaveBeenCalled();await click("管理员：本轮增加调用预算");expect(mocks.post.mock.calls[0][1].kind).toBe("extend_budget");});
 it("blocks a new question at the completed-round limit",async()=>{c.state="answered";c.roundOpen=false;c.roundsUsed=10;await render();await fill("why");expect(button("发送追问（新一轮）").disabled).toBe(true);expect(host.textContent).toContain("已到问答轮数上限");});
 it("requires explicit deletion confirmation and preserves revision guard",async()=>{mocks.delete.mockResolvedValue({ok:true});await render();await click("删除会话");expect(window.confirm).toHaveBeenCalled();expect(mocks.delete.mock.calls[0][1].body).toBe('{"revision":2}');expect(mocks.push).toHaveBeenCalledWith("/ai-tasks");});
});

describe("automatic editable result restoration",()=>{
 const result:NonNullable<DialogueView["result"]>={questionText:"fixture",answerText:"fixture answer",analysis:"fixture analysis",subject:"数学",knowledgePoints:[],wrongAnswerText:"",mistakeAnalysis:"",mistakeStatus:"unknown",requiresImage:false};
 it("automatically restores a completed result and original image without a retrieval button",async()=>{
  c.state="answered";c.result=result;c.input.originalImageBase64="data:image/png;base64,Yg==";await render();
  expect(host.querySelector('[data-testid="inline-editor"]')?.getAttribute("data-image")).toBe(c.input.originalImageBase64);expect(button("取回到编辑器，核对后存错题")).toBeUndefined();expect(mocks.post).not.toHaveBeenCalled();
  expect(host.querySelector('a[href="/"]')?.textContent).toBe("返回首页");
 });
 it("re-fetches current original pixels when background polling reaches answered",async()=>{
  c.state="active";await render();c.state="answered";c.result=result;c.input.originalImageBase64="data:image/png;base64,Yg==";await act(async()=>{await vi.advanceTimersByTimeAsync(2100);});
  expect(mocks.get.mock.calls.at(-1)?.[0]).toBe("/api/ai/conversations/fixture?restore=1");expect(host.querySelector('[data-testid="inline-editor"]')?.getAttribute("data-image")).toBe(c.input.originalImageBase64);
 });
 it("does not offer a result in a different notebook",async()=>{
  c.state="answered";c.result=result;await render({expectedSubjectId:"different"});expect(host.querySelector('[data-testid="inline-editor"]')).toBeNull();expect(host.textContent).toContain("属于其他错题本");
 });
 it("keeps the mounted draft when a follow-up begins",async()=>{
  c.state="answered";c.result=result;await render();const editor=host.querySelector('[data-testid="inline-editor"]');c.state="active";c.revision++;await click("刷新状态");expect(host.querySelector('[data-testid="inline-editor"]')).toBe(editor);
 });
});

describe("pre-dispatch endpoint rejections",()=>{
 it("does not claim that a rejected image request was sent",async()=>{
  c.steps=[{...c.steps[0],state:"failed",withImage:true,errorCode:"AI_ENDPOINT_REJECTED"}];
  await render();expect(host.textContent).toContain("含图请求未发送");expect(host.textContent).toContain("代理虚拟IP");expect(host.textContent).toContain("1次尝试");expect(host.textContent).not.toContain("已附图");
 });
 it("does not claim zero dispatch for unknown network acceptance",async()=>{
  c.steps=[{...c.steps[0],state:"unknown",withImage:true,errorCode:"AI_ACCEPTANCE_UNKNOWN"}];
  await render();expect(host.textContent).not.toContain("请求未发送");expect(host.textContent).toContain("状态不确定");
 });
});


describe("notebook result presentation",()=>{
 const solved:NonNullable<DialogueView["result"]>={questionText:"合成题目 $x^2=4$",answerText:"$x=\\pm 2$",analysis:"### 解题思路\n两边开平方。",subject:"数学",knowledgePoints:["平方根"],wrongAnswerText:"$x=2$",mistakeAnalysis:"遗漏负根，应检验两个根。",mistakeStatus:"wrong_attempt",requiresImage:false};
 it("shows question, answer, steps and mistake analysis separately for saved answer messages",async()=>{
  c.state="answered";c.result=solved;c.messages=[{id:"answer1",kind:"answer",round:1,at:new Date().toISOString(),text:JSON.stringify(solved)}];
  await render();
  for(const label of ["题目内容","参考答案","解题思路与步骤","错因分析","错误解答原文"])expect(host.textContent).toContain(label);
  for(const content of [solved.questionText,solved.wrongAnswerText,solved.mistakeAnalysis,"平方根"])expect(host.textContent).toContain(content);
  const sources=[...host.querySelectorAll("details[data-markdown-source]")];expect(sources.length).toBeGreaterThanOrEqual(5);expect(sources.every(d=>!d.hasAttribute("open"))).toBe(true);
  expect(host.textContent).toContain("直接编辑并添加错题");expect(mocks.post).not.toHaveBeenCalled();
 });
 it("also displays the latest result when older stored sessions contain no answer message",async()=>{
  c.state="answered";c.result=solved;await render();expect(host.textContent).toContain(solved.questionText);expect(host.textContent).toContain("直接编辑并添加错题");
 });
 it("warns before leaving an unsaved editor while preserving conversation history",async()=>{
  c.state="answered";c.result=solved;await render();vi.mocked(window.confirm).mockReturnValueOnce(false);
  const event=new MouseEvent("click",{bubbles:true,cancelable:true});await act(async()=>{host.querySelector('a[href="/"]')!.dispatchEvent(event);});expect(event.defaultPrevented).toBe(true);expect(mocks.post).not.toHaveBeenCalled();
 });
 it("keeps historical plain-text replies readable",async()=>{
  c.messages=[{id:"old",kind:"answer",round:1,at:new Date().toISOString(),text:"旧回复 $a+b$"}];await render();expect(host.textContent).toContain("旧回复 $a+b$");
 });
 it("does not invent personal mistakes when none were observed",async()=>{
  c.state="answered";c.result={...solved,wrongAnswerText:"",mistakeAnalysis:"",mistakeStatus:"not_attempted"};c.messages=[{id:"clean",kind:"answer",round:1,at:new Date().toISOString(),text:JSON.stringify(c.result)}];await render();expect(host.textContent).toContain("未提供错误作答，不推测个人错因");
 });
});

describe("safe failure explanations",()=>{
 it("renders a fixed localized cause next to the failed attempt",async()=>{
  Object.assign(c.steps[0],{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"JSON_INVALID"});
  await render();expect(host.textContent).toContain("不是完整有效的JSON");
 });
 it("distinguishes timed-out body from the historical generic unknown state",async()=>{
  Object.assign(c.steps[0],{state:"unknown",errorCode:"AI_ACCEPTANCE_UNKNOWN",diagnostic:"TIMEOUT_READING_BODY"});
  await render();expect(host.textContent).toContain("读取完整正文时超时");
 });
 it("does not render unrecognized diagnostic payloads",async()=>{
  Object.assign(c.steps[0],{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"PRIVATE-UNTRUSTED"});
  await render();expect(host.textContent).not.toContain("PRIVATE-UNTRUSTED");expect(host.textContent).toContain("未记录细分原因");
 });
});


it("explains supplemental confirmation and sends just the added text",async()=>{
 c.transcript={text:"synthetic original",facts:[],uncertainties:[],missingInformation:[]};await render();
 expect(host.textContent).toContain("已有识图题设一起发送解题");expect(host.textContent).toContain("无需重新输入完整题设");
 await fill("synthetic added condition");await click("继续当前轮");
 expect(mocks.post.mock.calls.at(-1)?.[1]).toMatchObject({kind:"continue",text:"synthetic added condition",revision:2});
 expect(mocks.post.mock.calls.at(-1)?.[1]).not.toHaveProperty("correctedTranscript");
});

describe("current process step activity",()=>{
 it("shows the current running step and stops after polling fails, then resumes after a successful read",async()=>{
  c.state="active";c.steps[0].state="running";c.steps[0].finishedAt=null;await render();expect(host.querySelector('[role=progressbar]')).not.toBeNull();
  mocks.get.mockRejectedValueOnce(Error('synthetic poll failure'));await act(async()=>{await vi.advanceTimersByTimeAsync(2100)});expect(host.querySelector('[role=progressbar]')).toBeNull();
  await click("刷新状态");expect(host.querySelector('[role=progressbar]')).not.toBeNull();
 });
 it.each(['answered','cancelling','cancelled','unknown'] as const)("stops the step indicator when parent state becomes %s despite a stale running step",async(state)=>{
  c.state="active";c.steps[0].state="running";c.steps[0].finishedAt=null;await render();expect(host.querySelector('[role=progressbar]')).not.toBeNull();
  c.state=state;c.revision++;await act(async()=>{await vi.advanceTimersByTimeAsync(2100)});expect(host.querySelector('[role=progressbar]')).toBeNull();
 });
});