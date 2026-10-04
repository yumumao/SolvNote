import {ConstructionSchema,compileConstruction,type ConstructionPlan} from "./ai-drawing/construction";
export interface SolutionContext {questionText?:string;answerText?:string;originalImage?:string|null;basePlan?:ConstructionPlan;auxiliaryPlan?:ConstructionPlan}
export interface SolutionSnapshot extends SolutionContext {analysis:string;includeQuestion:boolean;includeAnswer:boolean;includeOriginal?:boolean;includeBase?:boolean;includeAuxiliary?:boolean;fitWidth?:boolean;includeLatex?:boolean}
export interface DrawingShareState {questionText:string;answerText:string;analysis:string;image?:string|null;basePlan?:ConstructionPlan;auxiliaryPlan?:ConstructionPlan}
export function currentDrawingAttachments(state:DrawingShareState|null,questionText:string,answerText:string,analysis:string,image?:string|null):Pick<SolutionContext,'basePlan'|'auxiliaryPlan'>{
 if(!state||state.questionText!==questionText||state.image!==image||!answerText.trim())return {};
 return {basePlan:state.basePlan,auxiliaryPlan:state.answerText===answerText&&state.analysis===analysis?state.auxiliaryPlan:undefined};
}
export function localSolutionImage(value:unknown):value is string {
 return typeof value==='string'&&value.length<=12*1024*1024&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function plan(value:unknown,base:boolean):ConstructionPlan|undefined {
 const parsed=ConstructionSchema.safeParse(value);if(!parsed.success|| (base?parsed.data.steps.length!==0:parsed.data.steps.length===0))return;
 try{compileConstruction(parsed.data);return parsed.data}catch{return}
}
/** Explicit allowlist + bounded inputs for local cross-tab messages. No HTML, URLs or account objects. */
export function parseSolutionSnapshot(value:unknown):SolutionSnapshot|null {
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>;
 const text=(s:unknown)=>typeof s==='string'&&s.length<=250000?s:undefined;
 const analysis=text(v.analysis);if(!analysis?.trim())return null;
 const questionText=text(v.questionText),answerText=text(v.answerText),originalImage=localSolutionImage(v.originalImage)?v.originalImage:undefined;
 const basePlan=plan(v.basePlan,true),auxiliaryPlan=plan(v.auxiliaryPlan,false);
 return {analysis,questionText,answerText,originalImage,basePlan,auxiliaryPlan,fitWidth:v.fitWidth===true,includeLatex:v.includeLatex!==false,includeQuestion:v.includeQuestion===true&&!!questionText?.trim(),includeAnswer:v.includeAnswer===true&&!!answerText?.trim(),includeOriginal:v.includeOriginal===true&&!!originalImage,includeBase:v.includeBase===true&&!!basePlan,includeAuxiliary:v.includeAuxiliary===true&&!!auxiliaryPlan};
}
