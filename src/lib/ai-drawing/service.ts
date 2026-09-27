import type {JobInput} from "../ai-jobs/schema";
import {aiRun} from "../ai-jobs/context";
import {loadEffectiveAIConfig} from "../ai-access/effective-config";
import {runtimeConfig} from "../ai-access/runtime";
import {callChain} from "../ai/chain";
import {AIError} from "../ai/transport";
import {dataImage} from "../ai/managed-service";
import {parseConstruction} from "./parse";
import {compileConstruction,CONSTRUCTION_PROMPT} from "./construction";
import {approvedImageEditor} from "./settings";
export async function validateDrawingInput(kind:string,input:JobInput,userId:string){
    if(kind==="construction")return;
    if(!input.confirmImageEdit || !input.drawingPlan || !input.imageBase64 || !input.drawingRevision)throw Error("INVALID_REQUEST");
    compileConstruction(input.drawingPlan);
    await approvedImageEditor((await loadEffectiveAIConfig(userId)).config,input.drawingRevision);
}
export async function executeDrawing(kind:"construction"|"image_edit",input:JobInput){
    const image=dataImage(input.originalImageBase64||input.imageBase64,input.mimeType);
    const text=JSON.stringify({question:input.questionText,answer:input.answerText,analysis:input.analysis});
    if(kind==="construction"){
        const plan=await callChain(CONSTRUCTION_PROMPT,text,image,parseConstruction,{role:"solve",stage:"construction"});
        return {type:"construction" as const,plan};
    }
    if(!image||!input.drawingPlan||!input.confirmImageEdit)throw new AIError("AI_IMAGE_EDIT_INVALID_INPUT");
    compileConstruction(input.drawingPlan);
    const run=aiRun.getStore();if(!run)throw new AIError("AI_INTERNAL_ERROR");
    const config=await runtimeConfig(run);
    let choice;try{choice=await approvedImageEditor(config,input.drawingRevision);}catch{throw new AIError("AI_IMAGE_EDIT_SETTINGS_CHANGED");}
    const instruction=`仅在提供的原图上按构造方案添加辅助线和必要的新点标记，用红色虚线区分；原题文字、已有点名、角弧、线段与尺寸保持不变，不改题，不把生成的几何关系当成新题设。不输出推理草稿。当前已核对的题目和解法：${text}\n构造指示：${JSON.stringify(input.drawingPlan)}`;
    const imageDataUrl=await callChain(instruction,"请返回编辑后的图片。",image,s=>s,{role:"recognize",stage:"image_edit",imageEdit:true,modelId:choice.model.id});
    return {type:"image_edit" as const,imageDataUrl,modelName:choice.model.name,providerName:choice.provider.name};
}
