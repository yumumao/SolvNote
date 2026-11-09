// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock('@/lib/ai/chain',()=>({callChain:mocks.callChain}));
vi.mock('@/lib/ai-access/effective-config',()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock('@/lib/ai-access/runtime',()=>({runtimeConfig:vi.fn()}));
vi.mock('@/lib/ai-drawing/settings',()=>({approvedImageEditor:vi.fn()}));
vi.mock('@/lib/ai/managed-service',()=>({dataImage:(image?:string)=>image}));
import {drawingEvidenceFromDialogue,DrawingEvidenceSchema,prepareDrawingEvidence} from '@/lib/ai-drawing/evidence';
import {preserveDrawingEvidence} from '@/lib/ai-drawing/evidence-server';
import {ConstructionSchema,compileConstruction} from '@/lib/ai-drawing/construction';
import {executeDrawing} from '@/lib/ai-drawing/service';
import {JobInputSchema} from '@/lib/ai-jobs/schema';
import {parseConstructionSteps} from '@/lib/ai-drawing/parse';
import {diagramConditionLines} from '@/lib/ai-drawing/annotations';
const caption='图1：阴影甲表示草地，空白乙表示道路；单位为平方米。';
const base=ConstructionSchema.parse({title:'synthetic',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0},{id:'C',x:0,y:3}],segments:[['A','B'],['A','C']],steps:[]});
const transcript={text:'求图中阴影面积',facts:[{detail:caption,source:'image' as const},{detail:'文字题干条件',source:'text' as const},{detail:'未知来源内容'}],uncertainties:[],missingInformation:[]};
const makeEvidence=()=>DrawingEvidenceSchema.parse({authority:'machine',transcription:transcript.text,angles:[],uncertainties:[],clarifications:[],imageFacts:[caption]});
beforeEach(()=>vi.clearAllMocks());
describe('original caption preservation',()=>{
 it('hands off separately recognized image facts without copying the whole question or unspecified facts',()=>{
  const e=drawingEvidenceFromDialogue({transcript});
  expect(e?.imageFacts).toEqual([caption]);expect(e?.transcription).toBe(transcript.text);
 });
 it('retains full image text locally when the drawing model omits all notes',()=>{
  const e=makeEvidence(),before=JSON.stringify(e),plan=preserveDrawingEvidence(base,e);
  expect(plan.sourceCaptions).toEqual([caption]);expect(plan.notes||[]).toEqual([]);
  expect(JSON.stringify(e)).toBe(before);expect(base).not.toHaveProperty('sourceCaptions');
  const lines=diagramConditionLines([],[],plan.sourceCaptions);
  expect(lines).toEqual(['原图识读文字（待核对）：'+caption]);
 });
 it('keeps evidence-only text separate from confirmed geometry and all 24 generated notes',()=>{
  const notes=Array.from({length:24},(_,i)=>({text:'图注'+i,status:'confirmed' as const}));
  const e=makeEvidence();e.authority='verified';
  const plan=preserveDrawingEvidence({...base,notes},e);
  expect(plan.notes).toEqual(notes);expect(plan.sourceCaptions).toEqual([caption]);
 });
 it('preserves a full 1000-character caption instead of using a shortened excerpt',()=>{
  const text='甲'.repeat(995)+'结束标志。';const e=makeEvidence();e.imageFacts=[text];
  const plan=preserveDrawingEvidence(base,e);expect(plan.sourceCaptions).toEqual([text]);
 });
 it.each(['user_corrected','user_clarified'] as const)('does not restore stale machine facts after %s',authority=>{
  const e={...makeEvidence(),authority};
  expect(prepareDrawingEvidence(e).imageFacts||[]).toEqual([]);
  expect(preserveDrawingEvidence({...base,sourceCaptions:['provider invented provenance']},e).sourceCaptions||[]).toEqual([]);
 });
 it('does not trust model-returned source captions or blindly carry the previous base captions',()=>{
  expect(preserveDrawingEvidence({...base,sourceCaptions:['provider invented provenance']}).sourceCaptions).toBeUndefined();
 });
 it('deduplicates exact repeated text but preserves differing information and uncertainty',()=>{
  const e=makeEvidence();e.imageFacts=[caption,caption,'阴影甲'];
  const plan=preserveDrawingEvidence({...base,notes:[{text:caption,status:'confirmed'}]},e);
  expect(diagramConditionLines([],plan.notes||[],plan.sourceCaptions).filter(t=>t.includes(caption))).toHaveLength(1);
  expect(diagramConditionLines([],plan.notes||[],plan.sourceCaptions).join('')).toContain('阴影甲');
 });
 it('preserves source captions across serialized locking and auxiliary generation',()=>{
  const plan=ConstructionSchema.parse(JSON.parse(JSON.stringify(preserveDrawingEvidence(base,makeEvidence()))));
  const next=parseConstructionSteps(JSON.stringify({steps:[{description:'连接BC',operation:{kind:'segment',a:'B',b:'C'}}]}),plan);
  expect(next.sourceCaptions).toEqual([caption]);expect(compileConstruction(next).geometry.sourceCaptions).toEqual([caption]);
 });
 it('performs the handoff and repair in one drawing call with the same original image',async()=>{
  const e=drawingEvidenceFromDialogue({transcript}),image='data:image/png;base64,YQ==';
  mocks.callChain.mockImplementation(async(_prompt,text,actualImage,parse)=>{
   expect(JSON.parse(text).drawingEvidence.imageFacts).toEqual([caption]);expect(actualImage).toBe(image);
   return parse(JSON.stringify(base));
  });
  const result=await executeDrawing('construction',JobInputSchema.parse({questionText:transcript.text,imageBase64:image,drawingEvidence:e}));
  expect(result.type).toBe('construction');if(result.type==='construction')expect(result.plan.sourceCaptions).toEqual([caption]);
  expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
 it('keeps old evidence and old plans valid without manufacturing captions',()=>{
  const e=DrawingEvidenceSchema.parse({authority:'machine',transcription:'old',angles:[],uncertainties:[],clarifications:[]});
  expect(preserveDrawingEvidence(base,e)).toEqual(base);
 });
 it('rejects oversized or unsafe source captions while allowing inert literal markup',()=>{
  for(const sourceCaptions of [['x'.repeat(1001)],Array(101).fill('x'),['bad\u202e'],['bad\u0000']])expect(ConstructionSchema.safeParse({...base,sourceCaptions}).success).toBe(false);
  expect(ConstructionSchema.parse({...base,sourceCaptions:['<script>literal only</script>']}).sourceCaptions).toHaveLength(1);
 });
 it('does not repeat a long original caption split across consecutive notes',()=>{
  const first='甲'.repeat(200),last='乙'.repeat(200),notes=[{text:first,status:'confirmed' as const},{text:last,status:'confirmed' as const}];
  expect(diagramConditionLines([],notes,[first+last])).toEqual([first,last]);
  expect(diagramConditionLines([],notes,[first+' '+last])).toEqual([first,last]);
 });
 it('does not infer coverage from partial, reordered or differently qualified notes',()=>{
  for(const notes of [
   [{text:'甲',status:'confirmed' as const}],
   [{text:'乙',status:'confirmed' as const},{text:'甲',status:'confirmed' as const}],
   [{text:'甲',status:'confirmed' as const},{text:'乙',status:'uncertain' as const}],
   [{text:'甲',status:'confirmed' as const},{text:'无关内容',status:'confirmed' as const},{text:'乙',status:'confirmed' as const}],
  ])expect(diagramConditionLines([],notes,['甲乙'])).toContain('原图识读文字（待核对）：甲乙');
 });
});
