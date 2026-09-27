import { AIRequestError, aiErrorResponse } from "../ai-access";
import { ZodError } from "zod";
export function accessError(error:unknown){
    if(error instanceof AIRequestError)return aiErrorResponse(error);
    if(error instanceof ZodError)return aiErrorResponse(new AIRequestError(400,"INVALID_AI_ACCESS_REQUEST"));
    const code=error instanceof Error?error.message:"";
    if(["CONFIG_CONFLICT","AI_ACCESS_CONFLICT","MODEL_ID_REUSED"].includes(code))return aiErrorResponse(new AIRequestError(409,code));
    if(["DEFAULT_MODEL_LIMIT","MODEL_NOT_AVAILABLE","MODEL_ID_RESERVED","PRIVATE_KEY_REQUIRED","INVALID_EXPORT","UNSUPPORTED_EXPORT","INVALID_EXPORT_OR_PASSPHRASE","INVALID_EXPORT_PAYLOAD"].includes(code))return aiErrorResponse(new AIRequestError(400,code));
    // Auth stubs and non-AI authentication implementations can still fail closed.
    if(typeof error==="object" && error!==null && "status" in error && [401,403].includes(Number(error.status)))return aiErrorResponse(new AIRequestError(Number(error.status),"FORBIDDEN"));
    return aiErrorResponse(new AIRequestError(503,"AI_ACCESS_UNAVAILABLE"));
}
export function conflict():never{throw new AIRequestError(409,"AI_ACCESS_CONFLICT");}
