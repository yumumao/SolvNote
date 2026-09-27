import {userResponse} from "@/lib/user-management/http";
import {publicRegistrationStatus} from "@/lib/user-management/registration-settings";
export const dynamic="force-dynamic";
export async function GET(){return userResponse(async()=>{const status=await publicRegistrationStatus();return {...status,allowRegistration:status.enabled};});}
