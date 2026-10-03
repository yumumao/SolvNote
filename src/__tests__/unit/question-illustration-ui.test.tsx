import {mockNativeDialog} from "../helpers/native-dialog";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing} from "@/components/auxiliary-drawing";
import {apiClient,ApiError} from "@/lib/api-client";
let host:HTMLDivElement,root:Root,restoreDialog:()=>void;
const settings={revision:7,configRevision:8,providerId:"p",model:"image-01",enabled:true,providerName:"合成MiniMax",providers:[]};
const image="data:image/png;base64,YQ==";
const props={questionText:"半径为4的四分之一圆",answerText:"不应传入的答案",analysis:"不应传入的解析"};
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject};}
beforeEach(()=>{restoreDialog=mockNativeDialog();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(apiClient,'get').mockImplementation(async url=>url.includes('illustration-settings')?settings:{enabled:false});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();restoreDialog();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(extra:Partial<React.ComponentProps<typeof AuxiliaryDrawing>>={}){await act(async()=>root.render(<AuxiliaryDrawing {...props} {...extra}/>));}
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
async function click(text:string){expect(button(text),text).toBeTruthy();await act(async()=>button(text).click());}
async function check(label:string){const e=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);expect(e,label).toBeTruthy();await act(async()=>e!.click());}
async function fill(label:string,value:string){const e=host.querySelector(`[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function load(extra:Partial<React.ComponentProps<typeof AuxiliaryDrawing>>={}){await render(extra);await click('打开实验性AI重新配图 / 整图编辑');await click('载入当前题目并读取MiniMax设置');}
async function ready(){await click('整理最终提示词（不调用AI）');await check('确认配图收费');}
it('offers MiniMax separately without Gemini, original image or construction plan; loading never saves or calls AI',async()=>{
 const post=vi.spyOn(apiClient,'post');await load();expect(host.textContent).toContain('MiniMax重新配图');expect(host.textContent).toContain('Gemini原图编辑');expect(post).not.toHaveBeenCalled();expect(apiClient.get).toHaveBeenCalledWith('/api/ai/illustration-settings');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原文或作图描述"]')!.value).toBe(props.questionText);expect(host.textContent).not.toContain('保存创作配图设置');
});
it('requires explicit payment consent, sends only final text and prevents duplicate paid submissions',async()=>{
 const p=deferred(),post=vi.spyOn(apiClient,'post').mockReturnValue(p.promise);await load();await click('整理最终提示词（不调用AI）');expect(button('生成1张配图').disabled).toBe(true);await check('确认配图收费');await click('生成1张配图');await click('生成1张配图');expect(post).toHaveBeenCalledTimes(1);
 const [url,body]=post.mock.calls[0];expect(url).toBe('/api/ai/drawing/illustration');expect(Object.keys(body as object).sort()).toEqual(['confirmIllustration','illustrationRatio','illustrationRevision','questionText'].sort());expect(JSON.stringify(body)).not.toContain(props.answerText);expect(JSON.stringify(body)).not.toContain(props.analysis);expect((body as {questionText:string}).questionText).toContain(props.questionText);expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBeNull();expect(button('载入当前题目并读取MiniMax设置').disabled).toBe(true);
 await act(async()=>p.resolve({type:'illustration',imageDataUrl:image,modelName:'image-01',providerName:'合成'}));expect(host.querySelector('[role=progressbar]')).toBeNull();expect(host.querySelector('a[download="solvnote-illustration.png"]')).not.toBeNull();
});
it('loads original image locally, requires reviewed description and never sends it to MiniMax',async()=>{
 const post=vi.spyOn(apiClient,'post').mockResolvedValue({type:'illustration',imageDataUrl:image});await load({image});expect(post).not.toHaveBeenCalled();expect(host.querySelector('img[alt="待核对的参考原图，仅本地预览"]')?.getAttribute('src')).toBe(image);expect(button('整理最终提示词（不调用AI）').disabled).toBe(true);await fill('原图描述（可编辑）','已核对：两条半径和四分之一圆弧');await check('确认原图描述');await ready();await click('生成1张配图');expect(JSON.stringify(post.mock.calls[0][1])).not.toContain('data:image');expect(JSON.stringify(post.mock.calls[0][1])).toContain('两条半径');
});
it('only sends the reference to vision after a separate consent, and does not auto-generate',async()=>{
 const post=vi.spyOn(apiClient,'post').mockResolvedValue({type:'illustration_description',description:'圆弧',uncertainties:[]});await load({image});expect(button('识别原图描述').disabled).toBe(true);await check('确认识图收费');await click('识别原图描述');expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0][0]).toBe('/api/ai/drawing/illustration_describe');expect(post.mock.calls[0][1]).toEqual({imageBase64:image,confirmDescription:true});expect(button('生成1张配图').disabled).toBe(true);
});
it('invalidates old prompt when source changes and reloads explicitly without overwriting a draft',async()=>{
 const post=vi.spyOn(apiClient,'post');await load();await ready();await render({questionText:'改变后的合成题目'});expect(host.textContent).toContain('当前题目已变更');expect(button('生成1张配图').disabled).toBe(true);expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原文或作图描述"]')!.value).toBe(props.questionText);await click('生成1张配图');expect(post).not.toHaveBeenCalled();await click('载入当前题目并读取MiniMax设置');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原文或作图描述"]')!.value).toBe('改变后的合成题目');expect(host.querySelector('[aria-label="最终配图提示词"]')).toBeNull();
});
it.each(['disabled','failure'])('does not allow generation with %s settings',async mode=>{
 const post=vi.spyOn(apiClient,'post');vi.mocked(apiClient.get).mockImplementation(async()=>{if(mode==='failure')throw Error('synthetic');return {...settings,enabled:false};});await load();expect(host.textContent).toContain(mode==='failure'?'无法读取':'尚未启用');expect(host.querySelector('a[href="/admin/ai"]')).not.toBeNull();expect(post).not.toHaveBeenCalled();
});
it.each(['AI_ACCEPTANCE_UNKNOWN','AI_JOB_CANCELLED'])('stops progress and retains task link on %s without automatic retry',async code=>{
 const p=deferred();const post=vi.spyOn(apiClient,'post').mockImplementation((_url,_body,options)=>{options?.onJobAccepted?.('synthetic-job');return p.promise});await load();await ready();await click('生成1张配图');expect(host.querySelector('[role=progressbar]')).not.toBeNull();await act(async()=>p.reject(new ApiError(409,'synthetic',{message:code})));expect(host.querySelector('[role=progressbar]')).toBeNull();expect(host.querySelector('a[href="/ai-tasks?job=synthetic-job"]')).not.toBeNull();expect(post).toHaveBeenCalledTimes(1);expect(host.querySelector<HTMLInputElement>('[aria-label="确认配图收费"]')?.checked).toBe(false);
});
it('ignores unsafe initial image URLs without fetching external resources',async()=>{await load({image:'https://example.invalid/private.png'});expect(host.querySelector('img[src^="https:"]')).toBeNull();expect(host.textContent).toContain('原图未载入');});
it('honors outer disabled state',async()=>{await render({disabled:true});await click('打开实验性AI重新配图 / 整图编辑');expect(button('载入当前题目并读取MiniMax设置').disabled).toBe(true);});
