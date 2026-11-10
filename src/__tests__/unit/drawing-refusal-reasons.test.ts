// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseConstructionSteps,parseConstructionBase} from '@/lib/ai-drawing/parse';
import {ConstructionSchema,CONSTRUCTION_PROMPT} from '@/lib/ai-drawing/construction';
import {diagnosticMessage} from '@/lib/ai/diagnostics';

const base=ConstructionSchema.parse({title:'Synthetic base',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0}],segments:[],steps:[]});
const reasons=[
 ['missing_base_point','DRAWING_MISSING_BASE_POINT','点'],
 ['base_conflict','DRAWING_BASE_CONFLICT','底图'],
 ['circle_intersection','DRAWING_CIRCLE_INTERSECTION','圆与直线'],
 ['unsupported_operation','DRAWING_UNSUPPORTED_OPERATION','操作'],
 ['insufficient_information','DRAWING_INSUFFICIENT_INFORMATION','信息'],
 ['no_auxiliary_needed','DRAWING_NO_AUXILIARY_NEEDED','未提取到'],
 ['step_limit','DRAWING_STEP_LIMIT','16'],
] as const;
describe('bounded auxiliary refusal reasons',()=>{
 it.each(reasons)('preserves %s as a fixed diagnostic and allows the next candidate', (reason,diagnostic,text)=>{
  expect(()=>parseConstructionSteps(JSON.stringify({unsupported:true,reason}),base)).toThrow(expect.objectContaining({code:'AI_DRAWING_UNSUPPORTED',diagnostic,fallback:true}));
  expect(diagnosticMessage(diagnostic)).toContain(text);
  expect(diagnosticMessage(diagnostic)).toContain('本模型');
  expect(CONSTRUCTION_PROMPT).toContain(reason);
 });
 it('keeps legacy refusals explicit about the absence of a reason',()=>{
  expect(()=>parseConstructionSteps('{"unsupported":true}',base)).toThrow(expect.objectContaining({diagnostic:'DRAWING_UNSUPPORTED',fallback:true}));
  expect(diagnosticMessage('DRAWING_UNSUPPORTED')).toContain('未提供具体原因');
 });
 it.each([{unsupported:true,reason:'private-upstream-marker'},{unsupported:true,reason:'missing_base_point',detail:'private-upstream-marker'},{unsupported:true,reason:'base_conflict',steps:[]}])('does not accept arbitrary model details or mixed success/refusal: %j',value=>{
  expect(()=>parseConstructionSteps(JSON.stringify(value),base)).toThrow(expect.objectContaining({code:'AI_RESPONSE_ERROR',diagnostic:'DRAWING_SCHEMA_FIELDS'}));
 });
 it('keeps first-stage unsupported semantics separate',()=>{
  expect(()=>parseConstructionBase('{"unsupported":true}','题文')).toThrow(expect.objectContaining({code:'AI_DRAWING_UNSUPPORTED',fallback:false}));
 });
 it('keeps captions and exterior text when an existing supported segment succeeds',()=>{
  const source={...base,sourceText:'完整题文',sourceCaptions:['旧识图文字'],notes:[{text:'机器角标待核对',status:'uncertain' as const}]};
  const steps=[{description:'连接AB',operation:{kind:'segment',a:'A',b:'B'}}];
  expect(parseConstructionSteps(JSON.stringify({steps}),source)).toEqual({...source,steps});
  expect(source.steps).toEqual([]);
 });
});
