import {z} from "zod";
export const IllustrationModel=z.enum(["image-01","image-01-live"]);
export const IllustrationInput=z.object({
    prompt:z.string().trim().min(1).max(1500),
    ratio:z.enum(["1:1","16:9","4:3","3:2","2:3","3:4","9:16"]),
    model:IllustrationModel,
});
export type IllustrationRequest=z.infer<typeof IllustrationInput>;
export type IllustrationResult={type:"illustration";imageDataUrl:string;modelName:string;providerName:string};
/** Do not redirect an imported third-party credential to MiniMax or guess paths. */
export function miniMaxEndpoint(baseUrl:string):string|null{
    try{
        const u=new URL(baseUrl);
        if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.port||!["api.minimaxi.com","api.minimax.cn","api.minimax.io"].includes(u.hostname))return null;
        if(!["","/v1"].includes(u.pathname.replace(/\/+$/,"")))return null;
        return `${u.origin}/v1/image_generation`;
    }catch{return null;}
}
