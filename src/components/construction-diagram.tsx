"use client";
import {useRef} from "react";
import type {compileConstruction} from "@/lib/ai-drawing/construction";
import {layoutDiagramAnnotations,diagramConditionLines,appendDiagramCaption} from "@/lib/ai-drawing/annotations";
import {Button} from "./ui/button";
type Geometry=ReturnType<typeof compileConstruction>["geometry"];
const SVG_WIDTH=800;
const SVG_HEIGHT=500;
const VIEW_PADDING=30;

// All coordinates come from the whitelist compiler, never from arbitrary SVG or JS returned by AI.
export function ConstructionDiagram({geometry,visible,title,readOnly=false,compact=false,attachmentTitle,shownConditionLines=[]}:{geometry:Geometry;visible:number;title:string;readOnly?:boolean;compact?:boolean;attachmentTitle?:string;shownConditionLines?:readonly string[]}){
    const svg=useRef<SVGSVGElement>(null);
    const rounds=[...geometry.circles,...geometry.arcs];
    // The viewport depends ONLY on the locked source, including across separate jobs.
    // Auxiliary coordinates must never refit or otherwise move the base layer.
    const visibleDerivedPoints=geometry.derivedPoints.filter(p=>p.step<=visible);
    const visibleDerivedCircles=geometry.derivedCircles.filter(c=>c.step<=visible);
    const allPoints=[...geometry.basePoints,...visibleDerivedPoints];
    const xs=[...geometry.basePoints.map(p=>p.x),...rounds.flatMap(c=>[c.x-c.radius,c.x+c.radius])];
    const ys=[...geometry.basePoints.map(p=>p.y),...rounds.flatMap(c=>[c.y-c.radius,c.y+c.radius])];
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const scale=Math.min(720/Math.max(maxX-minX,1e-6),420/Math.max(maxY-minY,1e-6));
    const map=(p:{x:number;y:number})=>({x:400+(p.x-(minX+maxX)/2)*scale,y:250-(p.y-(minY+maxY)/2)*scale});
    const circleBounds=(c:Geometry["circles"][number]|Geometry["derivedCircles"][number])=>{const p=map(c),r=c.radius*scale;return [{x:p.x-r,y:p.y-r},{x:p.x+r,y:p.y+r}];};
    const points=new Map(allPoints.map(p=>[p.id,p]));
    const originals=new Map(geometry.basePoints.map(p=>[p.id,p]));
    const labels=layoutDiagramAnnotations(geometry.annotations||[],id=>map(originals.get(id)!),geometry.basePoints.map(p=>({...map(p),id:p.id})));
    const labelBounds=labels.flatMap(l=>l.bounds);
    const captionLines=diagramConditionLines(geometry.annotations||[],geometry.notes||[]);
    const hiddenLabels=labels.some(l=>l.hidden);
    const crowdedLabelNote="部分标记因图内拥挤或角区过小，仅在图注保留，请对照原图核验位置。";
    // A shared document may already show these source conditions under its redraw.
    // Compare complete display lines (including status), not keywords or geometry.
    const shown=new Set(shownConditionLines);
    const remainingLines=captionLines.filter(line=>!shown.has(line));
    const hiddenUnshown=labels.some(l=>l.hidden&&diagramConditionLines([l.annotation],[]).some(line=>!shown.has(line)));
    const displayedCaptionLines=hiddenUnshown?[...remainingLines,crowdedLabelNote]:remainingLines;
    // Standalone SVGs must remain self-contained even if their embedding hid duplicates.
    const allCaptionLines=hiddenLabels?[...captionLines,crowdedLabelNote]:captionLines;
    function renderSegment(s:Geometry["segments"][number],index:number,auxiliary:boolean){
        const a=map(points.get(s.a)!),b=map(points.get(s.b)!);
        return <line key={index} data-base-segment={auxiliary?undefined:"true"} data-aux-segment={auxiliary?"true":undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={auxiliary?"#dc2626":"#334155"} strokeWidth={2.5} strokeDasharray={auxiliary?"8 5":undefined}/>;
    }
    function renderPoint(p:Geometry["points"][number],auxiliary:boolean){
        const q=map(p);
        return <g key={p.id} data-base-point={auxiliary?undefined:p.id} data-aux-point={auxiliary?p.id:undefined}>
            <circle cx={q.x} cy={q.y} r={4} fill={auxiliary?"#dc2626":"#0f172a"}/>
            <text x={q.x+8} y={q.y-9} fontSize={18} fontFamily="sans-serif" fill={auxiliary?"#b91c1c":"#0f172a"} stroke="white" strokeWidth={3} paintOrder="stroke">{p.id}</text>
        </g>;
    }
    function expandedViewBox(){
        const bounds=[
            {x:0,y:0},{x:SVG_WIDTH,y:SVG_HEIGHT},
            ...allPoints.flatMap(pointBounds),
            ...labelBounds,
            ...[...geometry.circles,...visibleDerivedCircles].flatMap(circleBounds),
            ...geometry.arcs.flatMap(a=>{const start=map(a.start),end=map(a.end),r=a.radius*scale;return [{x:start.x-r,y:start.y-r},{x:start.x+r,y:start.y+r},{x:end.x-r,y:end.y-r},{x:end.x+r,y:end.y+r}];}),
        ];
        const left=Math.min(...bounds.map(p=>p.x))-VIEW_PADDING;
        const top=Math.min(...bounds.map(p=>p.y))-VIEW_PADDING;
        const right=Math.max(...bounds.map(p=>p.x))+VIEW_PADDING;
        const bottom=Math.max(...bounds.map(p=>p.y))+VIEW_PADDING;
        return {left,top,width:right-left,height:bottom-top};
    }
    // Crop empty canvas, never refit coordinates. Ordinary previews use only the locked
    // base bounds, so separate jobs and visible-step changes keep identical placement.
    // Conservative text bounds include the full allowed point ID (up to four glyphs).
    function pointBounds(p:Geometry["points"][number]){
        const q=map(p);return [{x:q.x-4,y:q.y-30},{x:q.x+8+p.id.length*18+3,y:q.y+4}];
    }
    function compactViewBox(cropPoints=allPoints,cropCircles=visibleDerivedCircles){
        const bounds=[...cropPoints.flatMap(pointBounds),...labelBounds];
        for(const c of [...geometry.circles,...cropCircles]){
            const p=map(c),r=c.radius*scale;
            bounds.push({x:p.x-r,y:p.y-r},{x:p.x+r,y:p.y+r});
        }
        for(const a of geometry.arcs){
            bounds.push(map(a.start),map(a.end));
            const start=Math.atan2(a.start.y-a.y,a.start.x-a.x),tau=2*Math.PI;
            for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
                const delta=a.direction==="ccw"?angle-start:start-angle;
                const swept=((delta%tau)+tau)%tau;
                if(swept<=a.span+1e-9)bounds.push(map({x:a.x+a.radius*Math.cos(angle),y:a.y+a.radius*Math.sin(angle)}));
            }
        }
        // Safety inset for strokes and label antialiasing; share crops include all visible points.
        const inset=12;
        const left=Math.min(...bounds.map(p=>p.x))-inset,top=Math.min(...bounds.map(p=>p.y))-inset;
        const right=Math.max(...bounds.map(p=>p.x))+inset,bottom=Math.max(...bounds.map(p=>p.y))+inset;
        return {left,top,width:right-left,height:bottom-top};
    }
    function serialize(expand:boolean){
        if(!svg.current)return null;
        const exported=svg.current.cloneNode(true) as SVGSVGElement;
        // Standalone SVG must not inherit the embedded preview's height cap or app-only CSS.
        // XMLSerializer supplies the namespace; avoid a duplicate plain xmlns attribute.
        exported.removeAttribute("xmlns");
        exported.removeAttribute("class");
        exported.style.removeProperty("max-height");
        exported.style.removeProperty("max-width");
        exported.style.removeProperty("margin-right");
        exported.setAttribute("width","100%");
        exported.setAttribute("height","100%");
        if(expand){
            const {left,top,width,height}=expandedViewBox();
            exported.setAttribute("viewBox",[left,top,width,height].join(" "));
            const background=exported.querySelector("rect");
            if(background)for(const [key,value] of Object.entries({x:left,y:top,width,height}))background.setAttribute(key,String(value));
        }
        appendDiagramCaption(exported,allCaptionLines);
        return new XMLSerializer().serializeToString(exported);
    }
    function createImageUrl(){
        const content=serialize(true);
        if(!content)return null;
        return URL.createObjectURL(new Blob([content],{type:"image/svg+xml;charset=utf-8"}));
    }
    function download(){
        const url=createImageUrl();
        if(!url)return;
        const a=document.createElement("a");a.href=url;a.download="auxiliary-construction.svg";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    function openFullImage(){
        const url=createImageUrl();
        if(!url)return;
        try{
            // noopener may return null even when the tab opens; never open a second fallback tab.
            window.open(url,"_blank","noopener,noreferrer");
        }finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
    }
    const shareCompact=readOnly&&compact;
    const bounds=readOnly?(shareCompact?compactViewBox():expandedViewBox()):compactViewBox(geometry.basePoints,[]);
    const outside=[...visibleDerivedPoints.flatMap(pointBounds),...visibleDerivedCircles.flatMap(circleBounds)].some(p=>p.x<bounds.left||p.x>bounds.left+bounds.width||p.y<bounds.top||p.y>bounds.top+bounds.height);
    // Cap width along with height: a tall SVG must not leave a wide empty CSS box.
    const maxWidth=readOnly?(shareCompact?Math.min(800,bounds.width):800):Math.min(800,bounds.width,500*bounds.width/bounds.height);
    return <div className={shareCompact?"space-y-1":"space-y-2"} data-compact-drawing={shareCompact||undefined}>
        {shareCompact?<p className="text-xs text-muted-foreground" style={{margin:0}}>重建示意图，红色为辅助构造；请与原图核对，不作为证明。</p>:<p className="text-sm text-muted-foreground">本地重建示意图（绘制无需联网，方案生成仍调用AI），不是在原图片上叠线。深色为原题底图，红色点和虚线为新增构造。旋转只添加辅助副本，原题底图保持原方向；阴影填色以原题图为准，请与原图核对，不覆盖原图。</p>}
        <svg ref={svg} data-solution-attachment={attachmentTitle} xmlns="http://www.w3.org/2000/svg" viewBox={[bounds.left,bounds.top,bounds.width,bounds.height].join(" ")} preserveAspectRatio="xMinYMin meet" role="img" aria-label={`${title}：辅助线示意图，第${visible}步`} className="block w-full border rounded-md" style={{background:"#fff",maxHeight:readOnly?undefined:500,maxWidth,marginRight:"auto"}}>
            <title>{title}（示意图，不作为证明）</title>
            <rect x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} fill="white"/>
            <g data-layer="base">
            {geometry.circles.map((c,i)=>{const p=map(c);return <circle key={i} data-base-circle="true" cx={p.x} cy={p.y} r={c.radius*scale} fill="none" stroke="#334155" strokeWidth={2.5}/>;})}
            {geometry.arcs.map((a,i)=>{const start=map(a.start),end=map(a.end),radius=a.radius*scale;return <path key={i} data-base-arc="true" d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${a.span>Math.PI?1:0} ${a.direction==="cw"?1:0} ${end.x} ${end.y}`} fill="none" stroke="#334155" strokeWidth={2.5}/>;})}
            {geometry.baseSegments.map((s,i)=>renderSegment(s,i,false))}
            {geometry.basePoints.map(p=>renderPoint(p,false))}
            {labels.filter(l=>!l.hidden).map((l,i)=><g key={i} data-diagram-annotation={l.annotation.kind}>
                {l.path&&<path d={l.path} fill="none" stroke="#1d4ed8" strokeWidth={1.5}/>}
                <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize={18} fontFamily="sans-serif" fill="#1d4ed8" stroke="white" strokeWidth={3} paintOrder="stroke">{l.annotation.text}</text>
            </g>)}
            </g>
            <g data-layer="auxiliary">
            {visibleDerivedCircles.map((c,i)=>{const p=map(c);return <circle key={i} data-aux-circle="true" cx={p.x} cy={p.y} r={c.radius*scale} fill="none" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="8 5"/>;})}
            {geometry.derivedSegments.filter(s=>s.step<=visible).map((s,i)=>renderSegment(s,i,true))}
            {visibleDerivedPoints.map(p=>renderPoint(p,true))}
            </g>
        </svg>
        {displayedCaptionLines.length>0&&<aside data-diagram-caption style={{fontSize:14,lineHeight:1.6,marginTop:4,overflowWrap:"anywhere",textAlign:"left",color:"#334155"}}>
            <p style={{margin:0,fontWeight:600}}>原图标记与图注（识别结果，请核对原图）</p>
            <ul style={{margin:"2px 0 0",paddingLeft:20}}>{displayedCaptionLines.map((line,i)=><li key={i}>{line}</li>)}</ul>
        </aside>}
        {outside && !readOnly && <p role="note" data-outside-note className="text-sm">部分辅助点、辅助圆或标签超出固定视窗，原题底图不会自动移动或缩放。可下载或在新标签页打开当前步骤的完整图查看全部辅助构造。</p>}
        {!readOnly && <div className="flex flex-wrap gap-2">
            <Button variant="outline" data-open-full-image onClick={openFullImage}>在新标签页打开完整图</Button>
            <Button variant="outline" onClick={download}>下载当前步骤示意图</Button>
        </div>}
    </div>;
}
