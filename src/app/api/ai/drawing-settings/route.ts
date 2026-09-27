import {requireUser,requireAdmin,assertSameOrigin,aiJson,AIRequestError} from "@/lib/ai-access";
import {readJSON} from "@/lib/ai-http";
import {dialogueHTTPError} from "@/lib/ai-dialogue/http";
import {drawingSettings,saveDrawingSettings} from "@/lib/ai-drawing/settings";
function error(e:unknown){if(e instanceof AIRequestError && ["AI_IMAGE_EDIT_UNSUPPORTED","CONFIG_CONFLICT"].includes(e.message))return aiJson({message:e.message},e.status);return dialogueHTTPError(e);}
export async function GET(req:Request){try{const u=await requireUser(req);return aiJson(await drawingSettings(u.role==="admin",u.id));}catch(e){return error(e);}}
export async function POST(req:Request){try{const u=await requireAdmin(req);assertSameOrigin(req);return aiJson(await saveDrawingSettings(u.id,await readJSON(req)));}catch(e){return error(e);}}
