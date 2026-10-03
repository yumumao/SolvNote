import {requireAdmin,assertSameOrigin,aiJson,AIRequestError} from "@/lib/ai-access";
import {readJSON,safeError} from "@/lib/ai-http";
import {getIllustrationSettings,saveIllustrationSettings} from "@/lib/ai-drawing/illustration-settings";
function error(e:unknown){if(e instanceof AIRequestError && ["AI_ILLUSTRATION_ENDPOINT","CONFIG_CONFLICT"].includes(e.message))return aiJson({message:e.message},e.status);return safeError(e);}
export async function GET(req:Request){try{const u=await requireAdmin(req);return aiJson(await getIllustrationSettings(u.id));}catch(e){return error(e);}}
export async function POST(req:Request){try{const u=await requireAdmin(req);assertSameOrigin(req);return aiJson(await saveIllustrationSettings(u.id,await readJSON(req,8192)));}catch(e){return error(e);}}
