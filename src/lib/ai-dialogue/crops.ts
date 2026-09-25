import sharp from "sharp";
import { RegionSchema, type ImageRegion } from "./geometry-schema";
import { AIError } from "../ai/transport";
/** Reproducible pixel crops, never generative enhancement. No filesystem writes. */
export async function detailCrops(image:string, regions:ImageRegion[]):Promise<string[]> {
    const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if(!match || image.length>12*1024*1024)throw new AIError("INVALID_IMAGE");
    try {
        const original=await sharp(Buffer.from(match[1],"base64"),{limitInputPixels:25000000,animated:false}).rotate().png().toBuffer({resolveWithObject:true});
        const {width,height}=original.info;
        const unique=[...new Map(regions.map(r=>[JSON.stringify(r),RegionSchema.parse(r)])).values()].slice(0,3);
        return await Promise.all(unique.map(async r=>{
            // Include neighbouring point names and rays rather than an isolated arc.
            const pad=0.06, left=Math.max(0,Math.floor((r.x-pad)*width)),top=Math.max(0,Math.floor((r.y-pad)*height));
            const right=Math.min(width,Math.ceil((r.x+r.width+pad)*width)),bottom=Math.min(height,Math.ceil((r.y+r.height+pad)*height));
            const data=await sharp(original.data).extract({left,top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)}).resize({width:1000,height:1000,fit:"inside",withoutEnlargement:false}).png().toBuffer();
            return `data:image/png;base64,${data.toString("base64")}`;
        }));
    } catch {throw new AIError("AI_IMAGE_DETAIL_FAILED");}
}
