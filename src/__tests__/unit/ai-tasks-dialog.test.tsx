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


describe('task history read failures are actionable and bounded',()=>{
 it.each([
  [401,'UNAUTHORIZED','登录'],[403,'AI_MODEL_ACCESS_REVOKED','模型使用权限'],
  [404,'NOT_FOUND','不存在或已过期'],[408,'AI_REQUEST_TIMEOUT_CHECK_TASKS','读取超时'],
  [503,'AUTHENTICATION_UNAVAILABLE','服务暂时不可用'],
 ])('shows a specific safe message for HTTP %s',async(status,code,text)=>{
  fixture(()=>response({message:code,raw:'private-upstream-marker'},Number(status)));await mount();await click('详情/取回结果');
  expect(dialog()?.textContent).toContain(text);expect(dialog()?.textContent).not.toContain('private-upstream-marker');
 });
 it('does not start overlapping list requests while a previous list is slow',async()=>{
  let resolve!:(r:Response)=>void;
  const mock=vi.fn(async(url:string)=>url==='/api/ai/conversations'?new Promise<Response>(r=>{resolve=r;}):response({jobs:[]}));
  vi.stubGlobal('fetch',mock);await mount();await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
  expect(mock.mock.calls.filter(([url])=>url==='/api/ai/conversations')).toHaveLength(1);
  await act(async()=>resolve(response({conversations:[]})));
 });
 it('does not claim a failed construction has a preview result',async()=>{
  fixture(()=>response({id:'owned',kind:'construction',state:'failed',errorCode:'AI_BUDGET_EXHAUSTED'}));await mount();await click('详情/取回结果');
  expect(dialog()?.textContent).not.toContain('见下方作图预览');
 });
});

it('restores a MiniMax image in the task dialog without POST or dumping base64 as text',async()=>{
 const f=fixture(()=>response({id:'owned',kind:'illustration',state:'success',result:{type:'illustration',imageDataUrl:'data:image/png;base64,YQ==',modelName:'image-01'},attemptsLog:[]}));
 await mount();await click('详情/取回结果');expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,YQ==');expect(dialog()?.querySelector('a[download]')).not.toBeNull();expect(dialog()?.textContent).not.toContain('data:image/png');expect(f.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});


it.each(['illustration','image_edit','construction','illustration_describe'])('shows indeterminate progress in restored %s tasks and stops on cancellation',async(kind)=>{
 let state='running';const f=fixture(()=>response({id:'owned',kind,state}));await mount();await click('详情/取回结果');const progress=dialog()?.querySelector('[role="progressbar"]');expect(progress).not.toBeNull();expect(progress?.hasAttribute('aria-valuenow')).toBe(false);
 state='cancelled';await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(dialog()?.querySelector('[role="progressbar"]')).toBeNull();expect(f.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);
});
it('stops the task animation when status polling fails rather than claiming it is still processing',async()=>{
 let failed=false;fixture(()=>failed?response({},503):response({id:'owned',kind:'illustration',state:'running'}));await mount();await click('详情/取回结果');expect(dialog()?.querySelector('[role="progressbar"]')).not.toBeNull();failed=true;await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(dialog()?.querySelector('[role="progressbar"]')).toBeNull();expect(dialog()?.textContent).toContain('暂时无法读取任务');
});
