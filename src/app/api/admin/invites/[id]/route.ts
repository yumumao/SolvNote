import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {updateInvite} from "@/lib/user-management/registration-settings";
import {revisionSchema} from "@/lib/user-management/schema";
type Context={params:Promise<{id:string}>};
export async function PATCH(req:Request,context:Context){return adminRequest(req,async user=>updateInvite(user.id,(await context.params).id,await readUserJson(req,8192),new Date(),user.sessionVersion));}
// Invitation-use audit records remain; DELETE deliberately revokes, never destroys history.
export async function DELETE(req:Request,context:Context){return adminRequest(req,async user=>updateInvite(user.id,(await context.params).id,{...revisionSchema.parse(await readUserJson(req,8192)),enabled:false},new Date(),user.sessionVersion));}
