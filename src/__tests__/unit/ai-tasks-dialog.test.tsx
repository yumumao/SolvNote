import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("@/components/ai-conversation",()=>({dialogueLabels:{}}));
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import AITasks from "@/app/ai-tasks/page";
const plan={title:"合成辅助线",points:[{id:"A",x:0,y:0},{id:"B",x:2,y:0}],segments:[],steps:[{description:"连线",operation:{kind:"segment",a:"A",b:"B"}}]};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);window.history.replaceState({testState:true},"","/ai-tasks?filter=all");});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,"","/");});
const dialog=()=>document.querySelector('[role="dialog"]');
const click=async(text:string)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(b).toBeDefined();await act(async()=>b!.click());};
async function mount(){await act(async()=>root.render(<AITasks/>));await act(async()=>{await vi.advanceTimersByTimeAsync(1);});}
function fixture(detail:()=>Response|Promise<Response>){const mock=vi.fn(async(url:string,options:RequestInit)=>{expect(options.method).toBe('GET');if(url==='/api/ai/conversations')return response({conversations:[]});if(url==='/api/ai/jobs')return response({jobs:[{id:'owned',kind:'construction',state:'success',attempts:1,createdAt:'2026-09-26T00:00:00Z'}]});if(url==='/api/ai/jobs/owned?restore=1')return detail();throw Error('unexpected request');});vi.stubGlobal('fetch',mock);return mock;}
const success=()=>response({id:'owned',kind:'construction',state:'success',result:{type:'construction',plan},attemptsLog:[{state:'success',modelName:'合成模型'}]});
describe('short task recovery dialog',()=>{
 it('opens results in an accessible dialog and closes without cancellation, clearing only job from URL',async()=>{
  const fetchMock=fixture(success);await mount();const opener=host.querySelector('article button') as HTMLButtonElement;opener.focus();await click('详情/取回结果');
  expect(dialog()).not.toBeNull();expect(dialog()?.getAttribute('aria-labelledby')).toBeTruthy();expect(dialog()?.textContent).toContain('任务详情');expect(dialog()?.querySelector('svg')).not.toBeNull();expect(host.querySelector('svg')).toBeNull();expect(dialog()?.textContent).toContain('合成模型');expect(dialog()?.querySelector('[data-task-detail-scroll]')).not.toBeNull();
  expect(new URLSearchParams(location.search).get('job')).toBe('owned');await click('关闭详情');await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(dialog()).toBeNull();expect(location.search).toBe('?filter=all');expect(history.state).toMatchObject({testState:true});expect(document.activeElement).toBe(opener);
  await click('详情/取回结果');expect(dialog()?.querySelector('svg')).not.toBeNull();expect(fetchMock.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
 });
 it('opens a copied URL during loading and ignores completion after Escape',async()=>{
  window.history.replaceState(null,'','/ai-tasks?job=owned');let finish!:(r:Response)=>void;fixture(()=>new Promise(r=>{finish=r;}));await mount();expect(dialog()?.textContent).toContain('正在读取任务结果');
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(dialog()).toBeNull();expect(location.search).toBe('');await act(async()=>finish(success()));expect(dialog()).toBeNull();
 });
 it('keeps read errors and the retry action inside the dialog without re-submitting',async()=>{
  let fail=true;fixture(()=>fail?response({},503):success());await mount();await click('详情/取回结果');expect(dialog()?.textContent).toContain('暂时无法读取任务');fail=false;await click('重新读取本次任务（不重新生成）');expect(dialog()?.querySelector('svg')).not.toBeNull();
 });
 it('preserves analyze editor recovery, raw result and unknown-state warning',async()=>{
  fixture(()=>response({id:'owned',kind:'analyze',state:'success',result:{answerText:'合成答案'},input:{subjectId:'math'}}));await mount();await click('详情/取回结果');expect(dialog()?.querySelector('a')?.getAttribute('href')).toBe('/notebooks/math/add?job=owned');expect(dialog()?.textContent).toContain('合成答案');
  await click('关闭详情');fixture(()=>response({id:'owned',kind:'construction',state:'unknown',errorCode:'AI_ACCEPTANCE_UNKNOWN'}));await click('详情/取回结果');expect(dialog()?.textContent).toContain('这里不会自动重新收费');
 });
});
