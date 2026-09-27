import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { masterKey } from "../ai-config/vault";
import { parseConfig, type PortableConfig } from "../ai-config/schema";
const aad = (userId:string) => Buffer.from(JSON.stringify(["solvnote-user-ai",1,userId]),"utf8");
export function protectUserConfig(userId:string, config:PortableConfig):string {
    const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",masterKey(),iv);
    cipher.setAAD(aad(userId));
    const data=Buffer.concat([cipher.update(JSON.stringify(parseConfig(config)),"utf8"),cipher.final(),cipher.getAuthTag()]);
    return JSON.stringify({v:1,iv:iv.toString("base64"),data:data.toString("base64")});
}
export function unprotectUserConfig(userId:string, payload:string):PortableConfig {
    const e=JSON.parse(payload);
    if(e.v!==1 || typeof e.iv!=="string" || typeof e.data!=="string")throw Error("PRIVATE_VAULT_INVALID");
    const iv=Buffer.from(e.iv,"base64"), data=Buffer.from(e.data,"base64");
    if(iv.length!==12 || data.length<16)throw Error("PRIVATE_VAULT_INVALID");
    const cipher=createDecipheriv("aes-256-gcm",masterKey(),iv);
    cipher.setAAD(aad(userId));cipher.setAuthTag(data.subarray(-16));
    return parseConfig(JSON.parse(Buffer.concat([cipher.update(data.subarray(0,-16)),cipher.final()]).toString("utf8")));
}
