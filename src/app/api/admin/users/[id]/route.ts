import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {updateManagedUser,deleteManagedUser} from "@/lib/user-management/users";
type Context={params:Promise<{id:string}>};
export async function PATCH(req:Request,context:Context){return adminRequest(req,async user=>updateManagedUser(user.id,(await context.params).id,await readUserJson(req,8192),new Date(),user.sessionVersion));}
export async function DELETE(req:Request,context:Context){return adminRequest(req,async user=>deleteManagedUser(user.id,(await context.params).id,await readUserJson(req,8192),new Date(),user.sessionVersion));}
