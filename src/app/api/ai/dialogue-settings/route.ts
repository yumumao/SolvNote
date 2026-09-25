import { requireAdmin, assertSameOrigin, aiJson } from "@/lib/ai-access";
import { readJSON } from "@/lib/ai-http";
import { getDefaults, updateDefaults } from "@/lib/ai-dialogue/store";
import { dialogueHTTPError } from "@/lib/ai-dialogue/http";
export async function GET(req:Request){try{await requireAdmin(req);return aiJson(await getDefaults());}catch(e){return dialogueHTTPError(e);}}
export async function POST(req:Request){try{const u=await requireAdmin(req);assertSameOrigin(req);return aiJson(await updateDefaults(u.id,await readJSON(req)));}catch(e){return dialogueHTTPError(e);}}
