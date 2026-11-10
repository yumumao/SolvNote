// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock('@/lib/ai/chain',()=>({callChain:mocks.callChain}));
vi.mock('@/lib/ai-access/effective-config',()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock('@/lib/ai-access/runtime',()=>({runtimeConfig:vi.fn()}));
vi.mock('@/lib/ai-drawing/settings',()=>({approvedImageEditor:vi.fn()}));
vi.mock('@/lib/ai/managed-service',()=>({dataImage:(image?:string)=>image}));
import {executeDrawing} from '@/lib/ai-drawing/service';
import {ConstructionSchema,compileConstruction} from '@/lib/ai-drawing/construction';
import {JobInputSchema} from '@/lib/ai-jobs/schema';
import {drawingEvidenceFromDialogue} from '@/lib/ai-drawing/evidence';
import {parseConstructionSteps} from '@/lib/ai-drawing/parse';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
const text='一块长方形草地如下图，长为12米。\n\n图外说明：白色区域是道路，求阴影部分面积。';
const image='data:image/png;base64,YQ==';
const base=ConstructionSchema.parse({title:'synthetic',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0}],segments:[['A','B']],annotations:[{kind:'text',x:2,y:1,text:'12米'}],steps:[]});
const evidence=(source:'image'|'text'|undefined,clarified=false)=>drawingEvidenceFromDialogue({transcript:{text,facts:[{detail:'外侧说明',source}],uncertainties:[],missingInformation:[]},...(clarified?{transcriptClarifications:['A应在左侧']}:{})});
beforeEach(()=>{vi.clearAllMocks();mocks.callChain.mockImplementation(async(_prompt,_text,_image,parse)=>parse(JSON.stringify(base)));});
async function draw(patch:Record<string,unknown>={}){const result=await executeDrawing('construction',JobInputSchema.parse({questionText:text,imageBase64:image,...patch}));if(result.type!=='construction')throw Error('Wrong result');return result.plan;}
describe('exterior problem text travels with the original drawing',()=>{
 it.each([undefined,'text','image'] as const)('keeps full current text when fact source is %s and the model only returns inside labels',async source=>{
  const plan=await draw({drawingEvidence:evidence(source)});expect(plan.sourceText).toBe(text);expect(plan.annotations).toEqual(base.annotations);expect(plan.notes||[]).toEqual([]);
  expect(mocks.callChain).toHaveBeenCalledTimes(1);expect(mocks.callChain.mock.calls[0][2]).toBe(image);
 });
 it('also works from ordinary upload/editor without dialogue evidence',async()=>{expect((await draw()).sourceText).toBe(text);});
 it('does not erase current exterior text for an unrelated visual correction or earlier clarification',async()=>{
  const plan=await draw({drawingEvidence:evidence('image',true),drawingCorrection:'请将图形排得更紧凑'});
  expect(plan.sourceText).toBe(text);expect(plan.sourceCaptions).toBeUndefined();
 });
 it('uses the current edited question instead of old transcript, previous drawing or model rewritten text',async()=>{
  mocks.callChain.mockImplementation(async(_p,_t,_i,parse)=>parse(JSON.stringify({...base,sourceText:'模型改错的旧题干'})));
  const plan=await draw({questionText:'人工更正：长为15米，求草地面积。',drawingPreviousBase:{...base,sourceText:'长为12米'},drawingEvidence:evidence('image')});
  expect(plan.sourceText).toBe('人工更正：长为15米，求草地面积。');
 });
 it('does not copy answers or reasoning into the source text',async()=>{
  const plan=await draw({answerText:'SECRET_SYNTHETIC_ANSWER',analysis:'SECRET_SYNTHETIC_SOLUTION'});
  expect(plan.sourceText).toBe(text);expect(JSON.stringify(plan)).not.toContain('SECRET_SYNTHETIC');
 });
 it('keeps exterior text read from this image when no current question text exists',async()=>{
  mocks.callChain.mockImplementation(async(_p,_t,_i,parse)=>parse(JSON.stringify({...base,sourceText:text})));
  expect((await draw({questionText:''})).sourceText).toBe(text);expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
 it('keeps old plans and image-only results without text valid',async()=>{
  expect((await draw({questionText:''})).sourceText).toBeUndefined();expect(ConstructionSchema.parse(base)).toEqual(base);
 });
 it('preserves full text through serialized job, locked auxiliary plan and share snapshot',async()=>{
  const plan=await draw();const locked=JobInputSchema.parse(JSON.parse(JSON.stringify({questionText:text,drawingPlan:plan}))).drawingPlan!;
  const next=parseConstructionSteps(JSON.stringify({steps:[{description:'取中点M',operation:{kind:'midpoint',id:'M',a:'A',b:'B'}}]}),locked);
  expect(next.sourceText).toBe(text);expect(compileConstruction(next).geometry.sourceText).toBe(text);
  expect(parseSolutionSnapshot({analysis:'synthetic',basePlan:plan,auxiliaryPlan:next,includeBase:true})?.basePlan?.sourceText).toBe(text);
 });
 it('preserves 50000 characters without truncation and accepts multiline formulas',async()=>{
  const long='甲'.repeat(49993)+'末尾保留123';expect(long).toHaveLength(50000);expect((await draw({questionText:long})).sourceText).toBe(long);
  const formula=String.raw`已知$\frac{1}{2}$`+'\r\n第二行\t说明';expect((await draw({questionText:formula})).sourceText).toBe(formula);
 });
 it('bounds stored text and safely cleans invisible controls without evaluating markup',()=>{
  expect(ConstructionSchema.safeParse({...base,sourceText:'x'.repeat(50001)}).success).toBe(false);
  expect(ConstructionSchema.parse({...base,sourceText:'首段\u000c第二段\u000b第三段\u0085末段\u202e\u0000\uffff\ud800'}).sourceText).toBe('首段\n第二段\n第三段\n末段\ufffd\ufffd');
  expect(ConstructionSchema.parse({...base,sourceText:'<script>literal</script>\n第二行'}).sourceText).toContain('<script>literal</script>');
 });
 it('does not turn control characters from a valid current question into an AI fallback',async()=>{
  expect((await draw({questionText:'首段\f第二段\u202e\u0000'})).sourceText).toBe('首段\n第二段');
  expect(mocks.callChain).toHaveBeenCalledTimes(1);
  expect((await draw({questionText:'\u0000'})).sourceText).toBe('');
 });
 it.each([null,{},[], 'x'.repeat(50001)])('ignores a malformed model copy when the current question supplies source text (%#)',async sourceText=>{
  mocks.callChain.mockImplementation(async(_p,_t,_i,parse)=>parse(JSON.stringify({...base,sourceText})));
  expect((await draw()).sourceText).toBe(text);expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
 it('keeps unsupported and geometry validation strict when replacing model text with the current question',async()=>{
  mocks.callChain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse('{"unsupported":true}'));
  await expect(draw()).rejects.toMatchObject({code:'AI_DRAWING_UNSUPPORTED'});
  mocks.callChain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify({...base,segments:[['A','Z']],sourceText:null})));
  await expect(draw()).rejects.toMatchObject({code:'AI_DRAWING_INVALID'});
 });
});
