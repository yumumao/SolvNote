"use client";
import {useRef} from "react";
import type {compileConstruction} from "@/lib/ai-drawing/construction";
import {Button} from "./ui/button";
type Geometry=ReturnType<typeof compileConstruction>["geometry"];

// All coordinates come from the whitelist compiler, never from arbitrary SVG or JS returned by AI.
export function ConstructionDiagram({geometry,visible,title}:{geometry:Geometry;visible:number;title:string}){
    const svg=useRef<SVGSVGElement>(null);
    const rounds=[...geometry.circles,...geometry.arcs];
    const xs=[...geometry.points.map(p=>p.x),...rounds.flatMap(c=>[c.x-c.radius,c.x+c.radius])],ys=[...geometry.points.map(p=>p.y),...rounds.flatMap(c=>[c.y-c.radius,c.y+c.radius])];
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const scale=Math.min(720/Math.max(maxX-minX,1e-6),420/Math.max(maxY-minY,1e-6));
    const map=(p:{x:number;y:number})=>({x:400+(p.x-(minX+maxX)/2)*scale,y:250-(p.y-(minY+maxY)/2)*scale});
    const points=new Map(geometry.points.map(p=>[p.id,p]));
    function download(){
        if(!svg.current)return;
        const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg.current)],{type:"image/svg+xml;charset=utf-8"}));
        const a=document.createElement("a");a.href=url;a.download="auxiliary-construction.svg";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    return <div className="space-y-2">
        <p className="text-sm text-muted-foreground">本地重建示意图（无需联网），不是在原图片上叠线。深色为原题底图，红色点和虚线为新增构造；阴影填色以原题图为准，请与原图核对，不覆盖原图。</p>
        <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label={`${title}：辅助线示意图，第${visible}步`} className="w-full border rounded-md" style={{background:"#fff",maxHeight:500}}>
            <title>{title}（示意图，不作为证明）</title>
            <rect width="800" height="500" fill="white"/>
            {geometry.circles.map((c,i)=>{const p=map(c);return <circle key={i} data-base-circle="true" cx={p.x} cy={p.y} r={c.radius*scale} fill="none" stroke="#334155" strokeWidth={2.5}/>;})}
            {geometry.arcs.map((a,i)=>{const start=map(a.start),end=map(a.end),radius=a.radius*scale;return <path key={i} data-base-arc="true" d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${a.span>Math.PI?1:0} ${a.direction==="cw"?1:0} ${end.x} ${end.y}`} fill="none" stroke="#334155" strokeWidth={2.5}/>;})}
            {geometry.segments.filter(s=>s.step<=visible).map((s,i)=>{
                const a=map(points.get(s.a)!),b=map(points.get(s.b)!);
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={s.step?"#dc2626":"#334155"} strokeWidth={2.5} strokeDasharray={s.step?"8 5":undefined}/>;
            })}
            {geometry.points.filter(p=>p.step<=visible).map(p=>{const q=map(p);return <g key={p.id}>
                <circle cx={q.x} cy={q.y} r={4} fill={p.step?"#dc2626":"#0f172a"}/>
                <text x={q.x+8} y={q.y-9} fontSize={18} fontFamily="sans-serif" fill={p.step?"#b91c1c":"#0f172a"} stroke="white" strokeWidth={3} paintOrder="stroke">{p.id}</text>
            </g>})}
        </svg>
        <Button variant="outline" onClick={download}>下载当前步骤示意图</Button>
    </div>;
}
