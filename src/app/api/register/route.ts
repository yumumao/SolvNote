import {assertSameOrigin} from "@/lib/ai-access";
import {readUserJson,userResponse} from "@/lib/user-management/http";
import {registerUser} from "@/lib/user-management/registration";
import {requestIp} from "@/lib/user-management/rate-limit";
export const runtime="nodejs";
export async function POST(req:Request){return userResponse(async()=>{assertSameOrigin(req);return registerUser(await readUserJson(req,16*1024),{remoteIp:requestIp(req.headers)});},201);}
