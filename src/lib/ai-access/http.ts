import { AIRequestError, assertSameOrigin, readAIJson } from "../ai-access";
import { consumeAuthLimit } from "../user-management/rate-limit";
export async function readAccessMutation(req:Request,userId:string,kind:"policy"|"grants"|"private"|"import"){
    assertSameOrigin(req);
    if(!await consumeAuthLimit(`ai-access:${kind}:${userId}`,kind==="import"?10:60,60_000))throw new AIRequestError(429,"AI_ACCESS_RATE_LIMIT");
    return readAIJson(req,kind==="import"?1024*1024+8192:512*1024);
}
