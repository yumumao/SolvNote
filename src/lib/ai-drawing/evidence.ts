import {z} from 'zod';
import {AngleSchema} from '../ai-dialogue/geometry-schema';
import type {DialogueView} from '../ai-dialogue/types';
const clean=(max:number)=>z.string().max(max).refine(s=>![...s].some(c=>{const n=c.codePointAt(0)!;return (n<32&&![9,10,13].includes(n))||(n>=127&&n<=159)||(n>=0x202a&&n<=0x202e)||(n>=0x2066&&n<=0x2069);}), 'Invalid control character');
export const DrawingEvidenceSchema=z.object({
 authority:z.enum(['machine','verified','user_corrected','user_clarified']),
 transcription:clean(40000),
 angles:z.array(AngleSchema).max(24),
 uncertainties:z.array(clean(1000)).max(24),
 clarifications:z.array(clean(10000)).max(100),
}).strict().refine(e=>JSON.stringify(e).length<=100000,'Evidence too large');
export type DrawingEvidence=z.infer<typeof DrawingEvidenceSchema>;
type EvidenceSource=Pick<DialogueView,'transcript'|'geometryChecked'|'userCorrectedTranscript'|'transcriptClarifications'>;
/** Capture evidence together with its answer/image, never a newer polling state. */
export function drawingEvidenceFromDialogue(view:EvidenceSource):DrawingEvidence|undefined{
 if(!view.transcript)return;
 const t=view.transcript;
 const parsed=DrawingEvidenceSchema.safeParse({authority:view.transcriptClarifications?.length?'user_clarified':view.userCorrectedTranscript?'user_corrected':view.geometryChecked?'verified':'machine',transcription:t.text,angles:t.geometry?.angles||[],uncertainties:t.geometryUncertainties??t.uncertainties,clarifications:view.transcriptClarifications||[]});
 return parsed.success?prepareDrawingEvidence(parsed.data):undefined;
}
/** Human corrections supersede old structured machine labels; authority is evidence, not permission. */
export function prepareDrawingEvidence(input:DrawingEvidence):DrawingEvidence{
 const e=DrawingEvidenceSchema.parse(input);
 if(e.authority==='user_corrected'||e.authority==='user_clarified')e.angles=[];
 return e;
}
