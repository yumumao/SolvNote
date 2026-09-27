import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {resetManagedPassword} from "@/lib/user-management/users";
export async function POST(req:Request,context:{params:Promise<{id:string}>}){return adminRequest(req,async user=>resetManagedPassword(user.id,(await context.params).id,await readUserJson(req,8192),user.sessionVersion));}
