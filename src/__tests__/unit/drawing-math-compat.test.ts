import {describe,it,expect} from "vitest";
import {parseConstruction} from "@/lib/ai-drawing/parse";
import {normalizeMathMarkdown} from "@/lib/markdown-math";
import {compileConstruction, ConstructionSchema} from "@/lib/ai-drawing/construction";
const plan={title:"合成图",points:[{id:"O",x:0,y:0},{id:"A",x:4,y:0},{id:"B",x:0,y:4}],segments:[],arcs:[{center:"O",start:"A",end:"B",direction:"cw"}],steps:[{description:"连线",operation:{kind:"segment",a:"A",b:"B"}}]};
describe("drawing and math compatibility boundaries",()=>{
 it("reports explicit unsupported without fallback or private response details",()=>{
  try{parseConstruction('```json\n{"unsupported":true}\n```');throw Error("should fail");}catch(e){expect(e).toMatchObject({code:"AI_DRAWING_UNSUPPORTED",fallback:false,diagnostic:"DRAWING_UNSUPPORTED"});}
 });
 it("separates invalid geometry from invalid JSON",()=>{
  try{parseConstruction(JSON.stringify({...plan,arcs:[{...plan.arcs[0],end:"Z"}]}));throw Error("should fail");}catch(e){expect(e).toMatchObject({code:"AI_DRAWING_INVALID",fallback:true,diagnostic:"DRAWING_INVALID"});}
  expect(()=>parseConstruction('{"unsupported":true,"commands":"unsafe"}')).toThrow("AI_RESPONSE_ERROR");
 });
 it("supports major clockwise arcs and harmless coordinate rounding",()=>{
  const compiled=compileConstruction(ConstructionSchema.parse(plan));expect(compiled.geometry.arcs[0].span).toBeCloseTo(Math.PI*1.5);
  expect(()=>compileConstruction(ConstructionSchema.parse({...plan,points:plan.points.map(p=>p.id==='B'?{...p,y:4.00001}:p)}))).not.toThrow();
 });
 it("does not invent delimiters, touch escaped dollars, or rewrite indented code",()=>{
  for(const text of [String.raw`missing $$\begin{aligned}x&=1`,String.raw`\$\$ literal`,String.raw`    $$x$$`,String.raw`~~~tex
$$x$$
~~~`])expect(normalizeMathMarkdown(text)).toBe(text);
 });
 it("normalizes each block independently and keeps TeX intact",()=>{
  const normalized=normalizeMathMarkdown(String.raw`$$x=1$$
正文。
$$\begin{aligned}y&=2\\z&=3\end{aligned}$$
### 检验`);
  expect(normalized).toContain('$$\nx=1\n$$');expect(normalized).toContain(String.raw`y&=2\\z&=3`);expect(normalized).toContain('$$\n\n\n### 检验');
 });
});
