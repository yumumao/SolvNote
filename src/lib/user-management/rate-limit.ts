import {createHash} from "node:crypto";
import {isIP} from "node:net";
import {prisma} from "@/lib/prisma";
export async function consumeAuthLimit(subject:string,limit:number,windowMs:number,now=new Date()):Promise<boolean>{
 const key=createHash("sha256").update(subject).digest("hex"),end=new Date(now.getTime()+windowMs);
 const rows=await prisma.$queryRaw<Array<{count:number}>>`INSERT INTO "AuthRateLimit" ("key","count","windowEnd") VALUES (${key},1,${end}) ON CONFLICT("key") DO UPDATE SET "count"=CASE WHEN "windowEnd"<=${now} THEN 1 ELSE "count"+1 END, "windowEnd"=CASE WHEN "windowEnd"<=${now} THEN ${end} ELSE "windowEnd" END RETURNING "count"`;
 return Number(rows[0]?.count)<=limit;
}
export function requestIp(headers:Headers):string|undefined{
 if(process.env.SOLVNOTE_TRUST_PROXY_HEADERS?.trim().toLowerCase()!=="true")return undefined;
 const value=(headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
 return isIP(value) ? value : undefined;
}
export async function limitAuthentication(kind:"login"|"register",email:string,remoteIp?:string){
 const account=await consumeAuthLimit(kind+":account:"+email.toLowerCase(),kind==="login"?10:5,15*60_000);
 // Never merge unknown clients into a global bucket: a single caller could lock out the whole site.
 // Account limits and mandatory Turnstile always remain active; trusted ingress adds per-IP limits.
 const address=remoteIp ? await consumeAuthLimit(kind+":address:"+remoteIp,kind==="login"?100:30,15*60_000) : true;
 return account && address;
}
