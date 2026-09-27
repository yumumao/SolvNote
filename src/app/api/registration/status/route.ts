import {userResponse} from "@/lib/user-management/http";
import {publicRegistrationStatus} from "@/lib/user-management/registration-settings";
export const dynamic="force-dynamic";
export async function GET(){return userResponse(()=>publicRegistrationStatus());}
