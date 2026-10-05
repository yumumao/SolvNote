import {ConstructionSchema,compileConstruction,type ConstructionPlan} from "./construction";
import type {DrawingEvidence} from "./evidence";
export type BaseDrawingSource={questionText:string;image?:string|null;drawingEvidence?:DrawingEvidence};
type ReusableBase={plan:ConstructionPlan;correction:string};
export type BaseDrawingCache={
    lookup:(source:BaseDrawingSource,correction:string)=>ReusableBase|undefined;
    remember:(source:BaseDrawingSource,base:ReusableBase,version:number)=>void;
    invalidate:(source:BaseDrawingSource,version:number)=>void;
};
const key=(source:BaseDrawingSource)=>JSON.stringify([source.questionText,source.image||null,source.drawingEvidence||null]);
/** Page/conversation-local only. Never cache auxiliary steps, user confirmation or AI requests. */
export function createBaseDrawingCache():BaseDrawingCache {
    const entries=new Map<string,{version:number;base?:ReusableBase}>();
    return {
        lookup(source,correction){
            const value=entries.get(key(source))?.base;
            // An empty new editor inherits the successful source correction, not its old solution.
            if(!value || (correction!=="" && correction!==value.correction))return;
            return {...value,plan:ConstructionSchema.parse(value.plan)};
        },
        remember(source,value,version){
            const k=key(source),previous=entries.get(k);
            if(previous && previous.version>version)return; // A late old response cannot undo a newer correction.
            const plan=ConstructionSchema.parse(value.plan);
            if(plan.steps.length)throw new Error("Only a source base can be reused");
            compileConstruction(plan);
            entries.set(k,{version,base:{plan,correction:value.correction}});
        },
        invalidate(source,version){
            const k=key(source),previous=entries.get(k);
            if(!previous || previous.version<=version)entries.set(k,{version});
        },
    };
}
