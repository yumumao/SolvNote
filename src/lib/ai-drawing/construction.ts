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
    // Optional for old stored plans; circles belong to the original diagram.
    circles:z.array(z.object({center:id,through:id}).strict()).max(16).optional(),
    arcs:z.array(z.object({center:id,start:id,end:id,direction:z.enum(["ccw","cw"]),sector:z.boolean().optional()}).strict()).max(24).optional(),
    steps:z.array(z.object({description:z.string().trim().min(1).max(1000),operation}).strict()).min(1).max(16),
}).strict();
export type ConstructionPlan=z.infer<typeof ConstructionSchema>;
type Point={x:number;y:number};
type Arc=Point & {radius:number;start:Point;end:Point;span:number;direction:"ccw"|"cw";step:number};
export function compileConstruction(raw:ConstructionPlan){
    const plan=ConstructionSchema.parse(raw), points=new Map<string,Point>();
    const bad=():never=>{throw new Error("INVALID_CONSTRUCTION");};
    const get=(id:string)=>points.get(id)||bad();
    const define=(id:string,p:Point)=>{if(points.has(id)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6)bad();points.set(id,p);};
    const line=(a:string,b:string)=>{const p=get(a),q=get(b);const x=q.x-p.x,y=q.y-p.y;if(x*x+y*y<1e-12)bad();return {p,x,y,n:x*x+y*y};};
    // Reuse validated coordinates for a local preview; never evaluate model-supplied code.
    const geometry:{points:Array<Point & {id:string;step:number}>;segments:Array<{a:string;b:string;step:number}>;circles:Array<Point & {radius:number;step:number}>;arcs:Arc[]}={points:plan.points.map(p=>({...p,step:0})),segments:plan.segments.map(([a,b])=>({a,b,step:0})),circles:[],arcs:[]};
    const base:string[]=[];
    for(const p of plan.points){define(p.id,p);base.push(`${p.id}=(${p.x},${p.y})`);}
    for(const [i,[a,b]] of plan.segments.entries()){line(a,b);base.push(`base${i}=Segment(${a},${b})`);}
    for(const [i,c] of (plan.circles||[]).entries()){const l=line(c.center,c.through);geometry.circles.push({x:l.p.x,y:l.p.y,radius:Math.sqrt(l.n),step:0});base.push(`baseCircle${i}=Circle(${c.center},${c.through})`);}
    for(const [i,a] of (plan.arcs||[]).entries()){
        const l=line(a.center,a.start),r=line(a.center,a.end),radius=Math.sqrt(l.n);
        if(Math.abs(radius-Math.sqrt(r.n))>radius*1e-4)bad();
        line(a.start,a.end);
        const start=get(a.start),end=get(a.end),tau=2*Math.PI;
        const delta=Math.atan2(r.y,r.x)-Math.atan2(l.y,l.x);
        const span=((a.direction==="ccw"?delta:-delta)%tau+tau)%tau;
        if(span<1e-8||tau-span<1e-8)bad();
        geometry.arcs.push({...l.p,radius,start,end,span,direction:a.direction,step:0});
        const ends=a.direction==="ccw"?[a.start,a.end]:[a.end,a.start];
        base.push(`baseArc${i}=${a.sector?"CircularSector":"CircularArc"}(${a.center},${ends.join(",")})`);
        if(a.sector){base.push(`SetFilling(baseArc${i},0)`);geometry.segments.push({a:a.center,b:a.start,step:0},{a:a.center,b:a.end,step:0});}
    }
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
export const CONSTRUCTION_PROMPT=`你是几何辅助线构造助手。依据用户当前编辑的题设、答案和解析，先完整重建原题底图，再提炼解题中实际需要的辅助线；若附原图，校对点名与底图是否完整，不增加未经证实的题设。不要重新求解，不输出任意GeoGebra代码。只返回JSON：
{"title":"圆的底图与半径示意","points":[{"id":"O","x":0,"y":0},{"id":"A","x":4,"y":0}],"segments":[],"circles":[{"center":"O","through":"A"}],"steps":[{"description":"连接圆心与圆上已知点，显示解法所用半径","operation":{"kind":"segment","a":"O","b":"A"}}]}
points、segments、circles、arcs表示原题底图，在第0步就必须完整可见，steps才是新增辅助构造。原题已有边、圆、直径等不得省略，也不得放到辅助步骤冒充新增关系。circles通过已定义圆心center及圆上点through确定；两点必须不同，through不能只是圆内任意点。没有圆时给空数组。缺少圆心点名时可选用未占用的合法点名，但必须在描述中说明是为绘图命名的原有圆心，不新增几何假设。
points为示意底图坐标，必须满足已知关系，不可从像素外观断定等长/垂直；不能满足时不要编造。点名仅单个大写字母及可选数字，最多24点、36底图线段、16个底图圆、24段底图圆弧、16步；每步只一种操作，依赖必须先定义。操作白名单：segment(a,b)；midpoint(id,a,b)；foot(id,point,a,b)为点到直线的垂足；rotate(id,point,center,degrees)逆时针旋转；intersection(id,a,b,c,d)为两直线交点。不得重定义点或使用退化直线/平行交点。底图支持完整圆、圆弧与扇形边界。圆弧不能用完整圆替代：arcs示例为"arcs":[{"center":"O","start":"A","end":"B","direction":"ccw","sector":true}]，center是圆心，start/end为同一圆上的不同端点（与圆心等距），direction在数学坐标系中ccw为逆时针、cw为顺时针，允许优弧。sector为true同时绘制两条半径边界，false或省略只画弧；半圆、四分之一圆必须选正确端点与方向，完整圆请用circles。所有引用点先在points定义；坐标给足精度，勿使两端半径不一致。阴影题保留参与面积计算的圆、弧和线段边界，不要求重建复杂交并差阴影填色，不因无法精确涂色而拒绝整张构图；说明阴影位置以原图为准。确实无法用此白名单表达必要几何结构、或题设不足以构造时，只返回{"unsupported":true}，不要伪造图形。`;
