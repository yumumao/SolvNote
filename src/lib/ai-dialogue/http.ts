import { ZodError } from "zod";
import { AIRequestError, aiJson } from "../ai-access";
const codes = new Set(["FORBIDDEN","NOT_FOUND","REQUEST_CONFLICT","AI_QUEUE_FULL","DIALOGUE_CONFLICT","DIALOGUE_BUSY","DIALOGUE_UNKNOWN","DIALOGUE_ROUND_LIMIT","DIALOGUE_CALL_LIMIT","DIALOGUE_NOT_READY","DIALOGUE_TEXT_REQUIRED","DIALOGUE_LIMIT_INVALID","DIALOGUE_CONTEXT_LIMIT","DIALOGUE_STORAGE_LIMIT","INVALID_IMAGE","INVALID_REQUEST","AI_IMAGE_EDIT_UNSUPPORTED","AI_IMAGE_EDIT_SETTINGS_CHANGED","AI_IMAGE_EDIT_NOT_CONFIGURED"]);
export function dialogueHTTPError(error: unknown) {
    if(error instanceof AIRequestError){
        if(codes.has(error.message))return aiJson({message:error.message},error.status);
        if(error.status===401)return aiJson({message:"UNAUTHORIZED"},401);
        if(error.status===403)return aiJson({message:error.message==="Cross-origin request denied"?"ORIGIN_REJECTED":"FORBIDDEN"},403);
        if(error.status===503)return aiJson({message:"AUTH_OR_ORIGIN_UNAVAILABLE"},503);
    }
    if(error instanceof ZodError)return aiJson({message:"INVALID_REQUEST"},400);
    if(error instanceof Error && ["BODY_TOO_LARGE","INVALID_REQUEST"].includes(error.message))return aiJson({message:error.message},error.message==="BODY_TOO_LARGE"?413:400);
    return aiJson({message:"DIALOGUE_UNAVAILABLE"},503);
}
