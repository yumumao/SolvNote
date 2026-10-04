import { z } from "zod";
import {DiagramAnnotationSchema,DiagramNoteSchema,validateDiagramAnnotations,type DiagramAnnotation,type DiagramNote} from "./annotations";
// Identifiers are intentionally narrower than GeoGebra's language. No free-form commands.
const id = z.string().regex(/^[A-Z][0-9]{0,3}$/);
const number = z.number().finite().min(-10000).max(10000);
const operation = z.discriminatedUnion("kind", [
    z.object({kind:z.literal("segment"),a:id,b:id}).strict(),
    z.object({kind:z.literal("midpoint"),id,a:id,b:id}).strict(),
    z.object({kind:z.literal("foot"),id,point:id,a:id,b:id}).strict(),
    z.object({kind:z.literal("reflect"),id,point:id,a:id,b:id}).strict(),
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
    annotations:z.array(DiagramAnnotationSchema).max(32).optional(),
    notes:z.array(DiagramNoteSchema).max(24).optional(),
    steps:z.array(z.object({description:z.string().trim().min(1).max(1000),operation}).strict()).min(0).max(16),
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
    const basePoints=plan.points.map(p=>({...p,step:0 as const}));
    const baseSegments=plan.segments.map(([a,b])=>({a,b,step:0 as const}));
    const geometry:{basePoints:Array<Point & {id:string;step:0}>;derivedPoints:Array<Point & {id:string;step:number}>;baseSegments:Array<{a:string;b:string;step:0}>;derivedSegments:Array<{a:string;b:string;step:number}>;points:Array<Point & {id:string;step:number}>;segments:Array<{a:string;b:string;step:number}>;circles:Array<Point & {radius:number;step:0}>;arcs:Arc[];annotations:DiagramAnnotation[];notes:DiagramNote[]}={basePoints,derivedPoints:[],baseSegments,derivedSegments:[],points:[...basePoints],segments:[...baseSegments],circles:[],arcs:[],annotations:plan.annotations||[],notes:plan.notes||[]};
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
        if(a.sector){const boundary=[{a:a.center,b:a.start,step:0 as const},{a:a.center,b:a.end,step:0 as const}];base.push(`SetFilling(baseArc${i},0)`);geometry.baseSegments.push(...boundary);geometry.segments.push(...boundary);}
    }
    // Validate against original points BEFORE auxiliary points can be introduced.
    validateDiagramAnnotations(geometry.annotations,get);
    // GeoGebra receives the same frozen originals; auxiliary operations may only add objects.
    for(const command of [...base]){
        const name=command.match(/^([A-Za-z][A-Za-z0-9]*)=/)?.[1];
        if(name)base.push(`setFixed(${name},true,false)`);
    }
    const steps=plan.steps.map(({description,operation:o},index)=>{
        let command:string;
        if(o.kind==="segment"){line(o.a,o.b);const segment={a:o.a,b:o.b,step:index+1};geometry.derivedSegments.push(segment);geometry.segments.push(segment);command=`aux${index}=Segment(${o.a},${o.b})`;}
        else {
            let p:Point;
            if(o.kind==="midpoint") {line(o.a,o.b);const a=get(o.a),b=get(o.b);p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};command=`${o.id}=Midpoint(${o.a},${o.b})`;}
            else if(o.kind==="foot"){const l=line(o.a,o.b),q=get(o.point),t=((q.x-l.p.x)*l.x+(q.y-l.p.y)*l.y)/l.n;p={x:l.p.x+t*l.x,y:l.p.y+t*l.y};command=`${o.id}=ClosestPoint(Line(${o.a},${o.b}),${o.point})`;}
            else if(o.kind==="reflect"){const l=line(o.a,o.b),q=get(o.point),t=((q.x-l.p.x)*l.x+(q.y-l.p.y)*l.y)/l.n;p={x:2*(l.p.x+t*l.x)-q.x,y:2*(l.p.y+t*l.y)-q.y};command=`${o.id}=Reflect(${o.point},Line(${o.a},${o.b}))`;}
            else if(o.kind==="rotate"){const q=get(o.point),c=get(o.center),r=o.degrees*Math.PI/180,x=q.x-c.x,y=q.y-c.y;p={x:c.x+x*Math.cos(r)-y*Math.sin(r),y:c.y+x*Math.sin(r)+y*Math.cos(r)};command=`${o.id}=Rotate(${o.point},${o.degrees}°,${o.center})`;}
            else {const l=line(o.a,o.b),m=line(o.c,o.d),cross=l.x*m.y-l.y*m.x;if(Math.abs(cross)/Math.sqrt(l.n*m.n)<1e-8)bad();const t=((m.p.x-l.p.x)*m.y-(m.p.y-l.p.y)*m.x)/cross;p={x:l.p.x+t*l.x,y:l.p.y+t*l.y};command=`${o.id}=Intersect(Line(${o.a},${o.b}),Line(${o.c},${o.d}))`;}
            define(o.id,p);const derived={id:o.id,...p,step:index+1};geometry.derivedPoints.push(derived);geometry.points.push(derived);
        }
        const object=o.kind==="segment"?`aux${index}`:o.id;
        return {description,commands:[command,`SetColor(${object},220,60,60)`,...(o.kind==="segment"?[`SetLineStyle(${object},1)`]:[])]};
    });
    return {base,steps,geometry};
}
// These examples are compiled by regression tests; none predeclare step-created points.
export const constructionExamples: ConstructionPlan[] = [
    {title:"反射复制而非凭空指定角度",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"],["C","A"]],steps:[{description:"作B关于直线AC的对称点P，原点B不变；可用垂线及等距截取实现",operation:{kind:"reflect",id:"P",point:"B",a:"A",b:"C"}},{description:"连接AP",operation:{kind:"segment",a:"A",b:"P"}}]},
    {"title":"圆的底图与半径示意","points":[{"id":"O","x":0,"y":0},{"id":"A","x":4,"y":0}],"segments":[],"circles":[{"center":"O","through":"A"}],"arcs":[],"steps":[{"description":"连接圆心与已知圆上点","operation":{"kind":"segment","a":"O","b":"A"}}]},
    {"title":"新建中点再连接顶点","points":[{"id":"A","x":0,"y":0},{"id":"B","x":6,"y":0},{"id":"C","x":2,"y":4}],"segments":[["A","B"],["B","C"],["C","A"]],"circles":[],"arcs":[],"steps":[{"description":"在AB上构造新中点M","operation":{"kind":"midpoint","id":"M","a":"A","b":"B"}},{"description":"连接原有顶点C与新点M","operation":{"kind":"segment","a":"C","b":"M"}}]},
    {"title":"新建垂足再画垂线段","points":[{"id":"A","x":0,"y":0},{"id":"B","x":6,"y":0},{"id":"C","x":2,"y":4}],"segments":[["A","B"],["B","C"],["C","A"]],"circles":[],"arcs":[],"steps":[{"description":"作C到直线AB的垂足H","operation":{"kind":"foot","id":"H","point":"C","a":"A","b":"B"}},{"description":"连接C与新垂足H","operation":{"kind":"segment","a":"C","b":"H"}}]},
    {"title":"旋转复制但保留原图","points":[{"id":"A","x":0,"y":0},{"id":"B","x":0,"y":6},{"id":"C","x":4,"y":3}],"segments":[["A","B"],["B","C"],["C","A"]],"circles":[],"arcs":[],"steps":[{"description":"利用等边三角形可作60度角，将B绕A逆时针旋转60度得到辅助点R，原点B保持不动","operation":{"kind":"rotate","id":"R","point":"B","center":"A","degrees":60}},{"description":"复制同一60度角，将C绕A逆时针旋转60度得到辅助点S，原点C保持不动","operation":{"kind":"rotate","id":"S","point":"C","center":"A","degrees":60}},{"description":"连接旋转后的辅助三角形","operation":{"kind":"segment","a":"A","b":"R"}},{"description":"连接旋转后的辅助三角形","operation":{"kind":"segment","a":"R","b":"S"}},{"description":"连接旋转后的辅助三角形","operation":{"kind":"segment","a":"S","b":"A"}}]},
    {"title":"由两条直线构造交点","points":[{"id":"A","x":0,"y":0},{"id":"B","x":6,"y":0},{"id":"C","x":6,"y":4},{"id":"D","x":0,"y":4}],"segments":[["A","B"],["B","C"],["C","D"],["D","A"]],"circles":[],"arcs":[],"steps":[{"description":"连接对角线AC","operation":{"kind":"segment","a":"A","b":"C"}},{"description":"连接对角线BD","operation":{"kind":"segment","a":"B","b":"D"}},{"description":"作直线AC与BD的交点E","operation":{"kind":"intersection","id":"E","a":"A","b":"C","c":"B","d":"D"}}]}
];
const DRAWING_LAYOUT_RULES = "原题底图是不可变的源图层，不得整体旋转、镜像或翻转原题底图，也不能平移、缩放或改写原有点的坐标。坐标轴固定为x向右、y向上。按原图保持点的上下左右位置、边的朝向与图形的整体布局，不能把斜边摆平或把旋转后的副本冒充原图。原图同时提供布局和明确标出的题目条件：角号、角值、长度、直角符号、等长刻痕、平行箭头等，即使文字题干未写也要保留；但不得从外观推断未经明确标记或题设确认的等长、垂直或其他几何关系。阴影位置以原图为准，不要求精确涂色。";
export const BASE_CONSTRUCTION_PROMPT = `你是原题底图重建助手。这是独立的第一阶段，只读取原题与原图，不读取答案或解法，不设计辅助线。${DRAWING_LAYOUT_RULES}
只返回严格JSON，不套type/plan/result外壳，不加额外说明字段。请求JSON包含question和correction；correction是用户针对原题底图的视觉/结构纠正说明（例如方向、点位、标签或已有边），优先按其修订底图，但不要把它当作新增题设、答案或辅助线指令。若correction与原图冲突，以用户明确纠正为优先；仍无法确认时只返回{"unsupported":true}，不能猜测。示例：
{"title":"原题底图","points":[{"id":"A","x":0,"y":4},{"id":"B","x":0,"y":0},{"id":"C","x":4,"y":0},{"id":"D","x":4,"y":4}],"segments":[["A","B"],["B","C"],["C","D"],["D","A"]],"circles":[],"arcs":[],"steps":[]}

原图标记使用可选annotations数组（最多32项），图下注释使用可选notes数组（最多24项）；没有则写[]。先逐一检查原图文字和符号，再输出，不能因题干未描述而忽略。annotations只存能明确识别并可靠定位的原题标注，不存推导结论，不用计算值替换原图数值；text为1到24字纯单行文本，按原图保留，例如角号只写"1"而非猜为"1°"。
角标格式为{"kind":"angle","a":"A","vertex":"O","b":"B","direction":"ccw","text":"1"}，表示从OA到OB逆时针的角区标1；vertex是真实顶点，a/b分别位于两条边，cw顺时针，必须选对角区，不能把角号画到邻角。边长标格式为{"kind":"segment","a":"A","b":"B","side":"left","text":"4 cm"}，side可省略或为left/right，指从A到B方向的左/右侧。所有引用只能是原题points已有点；不要为了放标签编造新点。角标不是arcs中的几何圆弧。
notes格式为{"text":"AB与CD有相同的等长刻痕","status":"confirmed"}或{"text":"右上角的角值看不清，请核对原图","status":"uncertain"}，text为1到300字单行纯文本。复杂符号、其他图示条件或不能可靠定位的标记用图注兜底，尽量说明在哪个点/哪条边/图的哪个位置；confirmed仅用于原图或原题明确给出的条件，uncertain表示待核对，不作为已知条件或辅助构造依据。若角号本身看清但定位不清，把角号原文和定位待核对写入notes，不丢弃也不猜坐标；不能用图注伪造无法重建的原图结构，整体结构仍不能可靠表达时返回unsupported。等长刻痕、平行箭头、直角等能辨清就把对应关系写入confirmed图注，不根据外观补全。第一步输出前复查是否漏掉图内编号、数值、单位与关系符号。
steps必须为空数组。points只能包含原题已有点，不得提前放入解法新增点。必须保留原题全部边、线段、圆和弧。坐标须满足题设且保持原图方向，不能编造条件。点名为一个大写字母加0到3位数字；最多24点、36线段、16圆、24弧。坐标为-10000到10000之间的有限数值，不写表达式或数字字符串；title为1到160字。segments每项恰为两个点名的数组。
circles格式为{"center":"O","through":"A"}，through须为圆上点而非圆内点。arcs格式为{"center":"O","start":"A","end":"B","direction":"ccw","sector":true}，start/end为半径等长的不同端点；ccw逆时针、cw顺时针，sector=true绘制两条半径边界。圆弧不能用完整圆替代。缺圆心名时允许给原有圆心命名，不增加几何假设。线段、圆、弧只能引用points中已定义的点，禁止退化关系。空数组写[]，不写null。无法可靠表达原题结构或保持题设与布局时，只返回{"unsupported":true}，不能伪造。`;

export const CONSTRUCTION_PROMPT = `你是几何辅助线构造助手。这是第二阶段：用户已核对并锁定lockedBase。只提炼当前解答实际需要的辅助构造，不重新求解、不重建原图。${DRAWING_LAYOUT_RULES}
只返回{"steps":[...]}，不得返回title、points、segments、circles、arcs、annotations、notes或任何底图字段；底图和原图标记、图注由程序原样保留。读取lockedBase.annotations和notes中的明确条件，但uncertain仅为待核对内容，不能作为已知条件；不把解题推导补写成原图条件。不要输出GeoGebra代码。新点不得提前放入points，也不得与lockedBase或先前步骤中任何点重名。新增点只能通过下列白名单操作定义，依赖必须先定义。步骤最少1步、最多16步；description为1到1000字。操作中点名严格匹配一个大写字母加0到3位数字。
操作格式：segment(a,b)只连接已存在的点，不加id；midpoint(id,a,b)新建中点；foot(id,point,a,b)作点到直线的垂足；reflect(id,point,a,b)作点关于直线ab的对称副本；rotate(id,point,center,degrees)逆时针旋转副本，degrees为-360到360的有限数值；intersection(id,a,b,c,d)为两条不平行直线交点。每步只使用对应操作的字段。新点不自动画连线，需要另加segment步骤。旋转只产生旋转后的副本，原点原边原圆弧均保持不动。
尺规教学须先构造，再证明性质：使用已知线段与圆的交点、作垂线、取中点、轴对称、复制已知角等合法依据，不得把指定一个任意数值角当作尺规步骤。rotate的degrees仅是程序绘图参数，描述必须交代题设中可复制的角或合法构造依据；优先用reflect表达轴对称，不要把从对称关系推导出的角度反过来当作构造前提。若解答只写按某角度放一个点而没有合法依据，不能自行伪造证明，应返回unsupported。白名单确实无法表达、底图有误或不需要辅助线时只返回{"unsupported":true}。
以下是独立格式示例，每组先给已锁定的输入底图，下一行才是模型应返回的steps；这些不是当前题设，不得照抄输入底图到输出：
${constructionExamples.map(({steps,...base})=>"锁定输入示例："+JSON.stringify({...base,steps:[]})+"\n"+JSON.stringify({steps})).join("\n")}
最终仅返回steps对象或unsupported对象，不加未知字段、理由字段、说明文字、代码围栏或推理草稿。`;