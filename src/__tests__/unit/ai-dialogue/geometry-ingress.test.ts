// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {parseGeometryCheck,parseTranscript,TranscriptSchema} from '@/lib/ai-dialogue/protocol';
import {diagnosticMessage} from '@/lib/ai/diagnostics';

const angle={label:'1',vertex:'B',arms:['A','C']};
const transcript=(angles:unknown[])=>({text:'synthetic source',facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[],angles}});
const readers=[
 {name:'initial recognition',read:(angles:unknown[])=>parseTranscript(JSON.stringify(transcript(angles))).geometry!.angles},
 {name:'geometry check',read:(angles:unknown[])=>parseGeometryCheck(JSON.stringify({angles,geometryUncertainties:[]})).angles},
];
for(const reader of readers)describe(reader.name,()=>{
 it.each([
  {...angle,note:'synthetic extra comment'},
  {...angle,angleName:'∠ABC'},
  {label:'1',angleName:'∠ABC'},
  {label:'1',vertex:'B',rays:['BA','BC']},
  {...angle,arms:['射线BA','射线BC']},
  {...angle,arms:['BA','BC'],angleName:'∠ABC'},
  {...angle,rays:['BC','BA'],angle:'∠CBA',angleName:'∠ABC'},
 ])('accepts equivalent source notation without changing its meaning %#',value=>{
  const original=JSON.stringify(value),result=reader.read([value]);
  expect(result).toEqual([angle]);expect(JSON.stringify(value)).toBe(original);
  expect(TranscriptSchema.safeParse(transcript(result)).success).toBe(true);
 });
 it.each([['BA','BC'],['A1','A2'],['A_B','A_C']])('preserves multi-letter point names %j',(...arms)=>{
  expect(reader.read([{...angle,arms}])[0].arms).toEqual(arms);
 });
 it.each([
  [{...angle,angleName:'∠ADC'},'GEOMETRY_CONFLICT'],
  [{...angle,angleName:'∠ABC',angle:'∠ABD'},'GEOMETRY_CONFLICT'],
  [{...angle,rays:['BA','BD']},'GEOMETRY_CONFLICT'],
  [{...angle,rays:['AB','BC']},'GEOMETRY_CONFLICT'],
  [{...angle,arms:['B','C']},'GEOMETRY_DEGENERATE_ANGLE'],
  [{...angle,arms:['A','A']},'GEOMETRY_DEGENERATE_ANGLE'],
  [{...angle,arms:['A']},'GEOMETRY_SCHEMA_ARMS'],
  [{...angle,arms:['A','?']},'GEOMETRY_SCHEMA_ARMS'],
  [{...angle,arms:null,rays:['BA','BC']},'GEOMETRY_SCHEMA_ARMS'],
  [{...angle,vertex:'?'},'GEOMETRY_SCHEMA_VERTEX'],
  [{label:'1',arms:['A','C']},'GEOMETRY_SCHEMA_VERTEX'],
  [{...angle,label:1},'GEOMETRY_SCHEMA_LABEL'],
  [{...angle,label:''},'GEOMETRY_SCHEMA_LABEL'],
  [{...angle,angleName:'PRIVATE-UNSUPPORTED'},'GEOMETRY_SCHEMA_FIELDS'],
 ])('rejects invalid evidence with a fixed diagnostic %#',(value,diagnostic)=>{
  expect(()=>reader.read([value])).toThrow(expect.objectContaining({code:'AI_RESPONSE_ERROR',fallback:true,diagnostic}));
  expect(diagnosticMessage(diagnostic)).toBeTruthy();
 });
 it('rejects duplicate equivalent labels instead of merging or dropping an angle',()=>{
  expect(()=>reader.read([angle,{...angle,label:'∠1',arms:['A','D']}])).toThrow(expect.objectContaining({diagnostic:'GEOMETRY_DUPLICATE_LABEL'}));
 });
 it('distinguishes response size limits from geometric contradictions',()=>{
  expect(()=>reader.read(Array.from({length:25},(_,i)=>({...angle,label:String(i)})))).toThrow(expect.objectContaining({diagnostic:'GEOMETRY_SCHEMA_LIMIT'}));
 });
 it('never includes source values or unknown field names in public diagnostics',()=>{
  try{reader.read([{...angle,vertex:'PRIVATE-VERTEX',privateField:'PRIVATE-PAYLOAD'}]);throw Error('expected failure');}
  catch(error){expect(error).toMatchObject({diagnostic:'GEOMETRY_SCHEMA_VERTEX'});expect(JSON.stringify(error)).not.toContain('PRIVATE');expect(String(error)).toBe('Error: AI_RESPONSE_ERROR');}
 });
});
it('keeps the stored transcript schema strict despite accepting AI ingress aliases',()=>{
 expect(TranscriptSchema.safeParse(transcript([{...angle,note:'synthetic'}])).success).toBe(false);
 expect(parseTranscript(JSON.stringify(transcript([{...angle,note:'synthetic'}]))).geometry!.angles).toEqual([angle]);
});
it('preserves invalid optional crop fallback while diagnosing invalid geometry lists',()=>{
 expect(parseTranscript(JSON.stringify({...transcript([angle]),geometry:{regions:[{x:99}],angles:[{...angle,region:{x:99}}]}})).geometry).toEqual({regions:[],angles:[angle]});
 expect(()=>parseTranscript(JSON.stringify({...transcript([]),geometry:{regions:[],angles:'PRIVATE-LIST'}}))).toThrow(expect.objectContaining({diagnostic:'GEOMETRY_SCHEMA_FIELDS'}));
 expect(()=>parseGeometryCheck(JSON.stringify({angles:[],geometryUncertainties:{private:'PRIVATE'}}))).toThrow(expect.objectContaining({diagnostic:'GEOMETRY_SCHEMA_UNCERTAINTIES'}));
 expect(diagnosticMessage('GEOMETRY_INVALID')).toBeTruthy();
});
