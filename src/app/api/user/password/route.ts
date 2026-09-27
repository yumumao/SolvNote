import {userResponse,passwordUser,readUserJson} from "@/lib/user-management/http";
import {changeOwnPassword} from "@/lib/user-management/users";
export async function POST(req:Request){return userResponse(async()=>{const user=await passwordUser(req);return changeOwnPassword(user.id,await readUserJson(req,8192),user.sessionVersion);});}
