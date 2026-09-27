import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {getRegistrationSettings,saveRegistrationSettings} from "@/lib/user-management/registration-settings";
import {settingsDto} from "@/lib/user-management/dto";
import {getTurnstilePublicConfig} from "@/lib/security/turnstile";
export const dynamic="force-dynamic";
export async function GET(req:Request){return adminRequest(req,async()=>({...settingsDto(await getRegistrationSettings()),turnstileConfigured:getTurnstilePublicConfig().turnstileConfigured}));}
export async function PATCH(req:Request){return adminRequest(req,async user=>({...await saveRegistrationSettings(user.id,await readUserJson(req,8192),user.sessionVersion),turnstileConfigured:getTurnstilePublicConfig().turnstileConfigured}));}
