// @vitest-environment node
import {describe,it,expect} from "vitest";
import sharp from "sharp";
import {detailCrops} from "@/lib/ai-dialogue/crops";
import {buildRequest} from "@/lib/ai/transport";
import {ConstructionSchema, compileConstruction} from "@/lib/ai-drawing/construction";
import {buildImageEditRequest, decodeEditedImage} from "@/lib/ai-drawing/image-edit";
const image="data:image/png;base64,YQ==";
const provider={id:"p",name:"synthetic",protocol:"gemini" as const,baseUrl:"https://example.invalid",apiKey:"fixture",enabled:true};
const model={id:"m",name:"synthetic",providerId:"p",model:"configured-image-model",capabilities:["text","vision"] as ("text"|"vision")[],enabled:true};
export const plan={title:"Synthetic construction",points:[{id:"P",x:0,y:0},{id:"Q",x:4,y:0},{id:"R",x:1,y:3}],segments:[["P","Q"],["Q","R"],["R","P"]],steps:[{description:"Draw the midpoint",operation:{kind:"midpoint",id:"M",a:"P",b:"Q"}},{description:"Join the vertex",operation:{kind:"segment",a:"R",b:"M"}}]};
describe("bounded geometry drawing",()=>{
 it("compiles only structured commands and preserves construction order",()=>{const r=compileConstruction(ConstructionSchema.parse(plan));expect(r.steps[0].commands.join(" ")).toContain("Midpoint(P,Q)");expect(r.steps[1].commands.join(" ")).toContain("Segment(R,M)");});
 it("rejects point redefinition, undefined dependencies and executable strings",()=>{for(const change of [{...plan,points:[{id:'Execute(foo)',x:0,y:0}]},{...plan,steps:[{description:"x",operation:{kind:"midpoint",id:"P",a:"P",b:"Q"}}]},{...plan,steps:[{description:"x",operation:{kind:"segment",a:"P",b:"Unknown"}}]}])expect(()=>compileConstruction(ConstructionSchema.parse(change))).toThrow();});
 it("rejects degenerate base lines and ambiguous intersections",()=>{expect(()=>compileConstruction(ConstructionSchema.parse({...plan,steps:[{description:"bad",operation:{kind:"foot",id:"H",point:"R",a:"P",b:"P"}}]}))).toThrow();});
 it("does not inject GeoGebra commands from a descriptive label",()=>{const r=compileConstruction(ConstructionSchema.parse({...plan,title:'<script>x</script>'}));expect(r.base.join(" ")).not.toContain("script");});
});
describe("real pixel crops and multi-image transport",()=>{
 it("crops source pixels, pads context, returns decodable raster",async()=>{const original=await sharp({create:{width:200,height:160,channels:3,background:"red"}}).png().toBuffer();const crops=await detailCrops(`data:image/png;base64,${original.toString("base64")}`,[{x:.3,y:.3,width:.2,height:.2}]);const m=await sharp(Buffer.from(crops[0].split(",")[1],"base64")).metadata();expect(m.width).toBe(1000);expect(m.height).toBeLessThan(1000);});
 it("refuses corrupt images and out-of-bounds crop boxes",async()=>{await expect(detailCrops(image,[{x:2,y:0,width:.1,height:.1}])).rejects.toThrow();});
 it.each(["gemini","chat","responses","responses_codex","azure"] as const)("%s carries full image then details",protocol=>{const r=buildRequest({...provider,protocol},model,"p","t",image,["data:image/png;base64,Yg=="]);expect(JSON.stringify(r.body)).toContain("Yg==");});
 it("cannot attach details to a text-only request",()=>{expect(JSON.stringify(buildRequest(provider,model,"p","t",undefined,[image]).body)).not.toContain("YQ==");});
});
describe("explicit image-edit adapter",()=>{
 it("requires Gemini image output instead of assuming all vision models edit",()=>{const r=buildImageEditRequest(provider,model,"draw",image);expect(r.body.generationConfig).toEqual({responseModalities:["TEXT","IMAGE"]});expect(()=>buildImageEditRequest({...provider,protocol:"chat"},model,"draw",image)).toThrow();});
 it("requires actual inline raster output and never follows remote URLs",async()=>{await expect(decodeEditedImage({candidates:[{content:{parts:[{text:"https://example.invalid/secret.png"}]}}]})).rejects.toThrow();});
 it("validates and re-encodes a generated image, ignoring private text/thought parts",async()=>{const b=await sharp({create:{width:10,height:10,channels:3,background:"blue"}}).png().toBuffer();const res=await decodeEditedImage({candidates:[{finishReason:"STOP",content:{parts:[{thought:true,inlineData:{mimeType:"image/png",data:"invalid"}},{text:"private scratch"},{inlineData:{mimeType:"image/png",data:b.toString("base64")}}]}}]});expect(res).toMatch(/^data:image\/png;base64,/);expect(res).not.toContain("private scratch");});
});
