import {requireUser,aiJson} from "@/lib/ai-access";
import {listSolvingRecords} from "@/lib/solving-records/store";
import {AIRequestError} from "@/lib/ai-access";
export async function GET(req:Request) {
    try {const u=await requireUser(req);return aiJson(await listSolvingRecords(u.id,new URL(req.url).searchParams));}
    catch(e) {return aiJson({message:e instanceof AIRequestError?e.message:"RECORDS_UNAVAILABLE"},e instanceof AIRequestError?e.status:503);}
}
