import { z } from "zod";
// Identifiers are intentionally narrower than GeoGebra's language. No free-form commands.
const id = z.string().regex(/^[A-Z][0-9]{0,3}$/);
const number = z.number().finite().min(-10000).max(10000);
const operation = z.discriminatedUnion("kind", [
    z.object({kind:z.literal("segment"),a:id,b:id}).strict(),
    z.object({kind:z.literal("midpoint"),id,a:id,b:id}).strict(),
    z.object({kind:z.literal("foot"),id,point:id,a:id,b:id}).strict(),
    z.object({kind:z.literal("rotate"),id,point:id,center:id,degrees:z.number().finite().min(-360).max(360)}).strict(),
    z.object({kind:z.literal("intersection"),id,a:id,b:id,c:id,d:id}).strict(),
]);
export const ConstructionSchema = z.object({
    title:z.string().trim().min(1).max(160),
    points:z.array(z.object({id,x:number,y:number}).strict()).min(2).max(24),
    segments:z.array(z.tuple([id,id])).max(36),
    steps:z.array(z.object({description:z.string().trim().min(1).max(1000),operation}).strict()).min(1).max(16),
}).strict();
export type ConstructionPlan=z.infer<typeof ConstructionSchema>;
type Point={x:number;y:number};
export function compileConstruction(raw:ConstructionPlan){
    const plan=ConstructionSchema.parse(raw), points=new Map<string,Point>();
    const bad=():never=>{throw new Error("INVALID_CONSTRUCTION");};
    const get=(id:string)=>points.get(id)||bad();
    const define=(id:string,p:Point)=>{if(points.has(id)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6)bad();points.set(id,p);};
    const line=(a:string,b:string)=>{const p=get(a),q=get(b);const x=q.x-p.x,y=q.y-p.y;if(x*x+y*y<1e-12)bad();return {p,x,y,n:x*x+y*y};};
    // Reuse validated coordinates for a local preview; never evaluate model-supplied code.
    const geometry:{points:Array<Point & {id:string;step:number}>;segments:Array<{a:string;b:string;step:number}>}={points:plan.points.map(p=>({...p,step:0})),segments:plan.segments.map(([a,b])=>({a,b,step:0}))};
    const base:string[]=[];
    for(const p of plan.points){define(p.id,p);base.push(`${p.id}=(${p.x},${p.y})`);}
    for(const [i,[a,b]] of plan.segments.entries()){line(a,b);base.push(`base${i}=Segment(${a},${b})`);}
    const steps=plan.steps.map(({description,operation:o},index)=>{
        let command:string;
        if(o.kind==="segment"){line(o.a,o.b);geometry.segments.push({a:o.a,b:o.b,step:index+1});command=`aux${index}=Segment(${o.a},${o.b})`;}
        else {
            let p:Point;
            if(o.kind==="midpoint") {line(o.a,o.b);const a=get(o.a),b=get(o.b);p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};command=`${o.id}=Midpoint(${o.a},${o.b})`;}
            else if(o.kind==="foot"){const l=line(o.a,o.b),q=get(o.point),t=((q.x-l.p.x)*l.x+(q.y-l.p.y)*l.y)/l.n;p={x:l.p.x+t*l.x,y:l.p.y+t*l.y};command=`${o.id}=ClosestPoint(Line(${o.a},${o.b}),${o.point})`;}
            else if(o.kind==="rotate"){const q=get(o.point),c=get(o.center),r=o.degrees*Math.PI/180,x=q.x-c.x,y=q.y-c.y;p={x:c.x+x*Math.cos(r)-y*Math.sin(r),y:c.y+x*Math.sin(r)+y*Math.cos(r)};command=`${o.id}=Rotate(${o.point},${o.degrees}°,${o.center})`;}
            else {const l=line(o.a,o.b),m=line(o.c,o.d),cross=l.x*m.y-l.y*m.x;if(Math.abs(cross)/Math.sqrt(l.n*m.n)<1e-8)bad();const t=((m.p.x-l.p.x)*m.y-(m.p.y-l.p.y)*m.x)/cross;p={x:l.p.x+t*l.x,y:l.p.y+t*l.y};command=`${o.id}=Intersect(Line(${o.a},${o.b}),Line(${o.c},${o.d}))`;}
            define(o.id,p);geometry.points.push({id:o.id,...p,step:index+1});
        }
        const object=o.kind==="segment"?`aux${index}`:o.id;
        return {description,commands:[command,`SetColor(${object},220,60,60)`,...(o.kind==="segment"?[`SetLineStyle(${object},1)`]:[])]};
    });
    return {base,steps,geometry};
}
export const CONSTRUCTION_PROMPT=`你是几何辅助线构造助手。依据用户当前编辑的题设、答案和解析，提炼解题中实际需要的辅助线；若附原图，校对点名，不增加未经证实的题设。不要重新求解，不输出任意GeoGebra代码。只返回JSON：
{"title":"构造主题","points":[{"id":"A","x":0,"y":0},{"id":"B","x":4,"y":0}],"segments":[["A","B"]],"steps":[{"description":"为何这样作图及与解法的关系","operation":{"kind":"midpoint","id":"M","a":"A","b":"B"}}]}
points为示意底图坐标，必须满足已知关系，不可从像素外观断定等长/垂直；不能满足时不要编造。点名仅单个大写字母及可选数字，最多24点、36底图线段、16步；每步只一种操作，依赖必须先定义。操作白名单：segment(a,b)；midpoint(id,a,b)；foot(id,point,a,b)为点到直线的垂足；rotate(id,point,center,degrees)逆时针旋转；intersection(id,a,b,c,d)为两直线交点。不得重定义点或使用退化直线/平行交点。不支持的圆弧、任意曲线或无法确定的构造请返回{"unsupported":true}，不要凑造。描述逐步说明构造依据；图是示意而非证明。`;
