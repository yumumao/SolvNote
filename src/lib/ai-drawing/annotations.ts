import {z} from 'zod';
const id=z.string().regex(/^[A-Z][0-9]{0,3}$/);
// Plain, single-line text only. It never enters GeoGebra commands or markup parsers.
const text=(limit:number)=>z.string().trim().min(1).max(limit).refine(s=>![...s].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0x202a&&n<=0x202e)||(n>=0x2066&&n<=0x2069);}), 'Invalid control character');
export const DiagramAnnotationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('angle'),a:id,vertex:id,b:id,direction:z.enum(['ccw','cw']),text:text(24)}).strict(),
 z.object({kind:z.literal('segment'),a:id,b:id,side:z.enum(['left','right']).optional(),text:text(24)}).strict(),
]);
export const DiagramNoteSchema=z.object({text:text(300),status:z.enum(['confirmed','uncertain'])}).strict();
export type DiagramAnnotation=z.infer<typeof DiagramAnnotationSchema>;
export type DiagramNote=z.infer<typeof DiagramNoteSchema>;
type Point={x:number;y:number};
export function validateDiagramAnnotations(annotations:DiagramAnnotation[],get:(id:string)=>Point){
 for(const a of annotations){
  const p=get(a.a),q=get(a.b);
  const distance=(p:Point,q:Point)=>Math.hypot(p.x-q.x,p.y-q.y);
  if(distance(p,q)<1e-6)throw Error('INVALID_CONSTRUCTION');
  if(a.kind==='angle'){
   const v=get(a.vertex);if(distance(p,v)<1e-6||distance(q,v)<1e-6)throw Error('INVALID_CONSTRUCTION');
   const cross=(p.x-v.x)*(q.y-v.y)-(p.y-v.y)*(q.x-v.x),dot=(p.x-v.x)*(q.x-v.x)+(p.y-v.y)*(q.y-v.y);
   if(Math.abs(cross)/(distance(p,v)*distance(q,v))<1e-8&&dot>0)throw Error('INVALID_CONSTRUCTION');
  }
 }
}
/** Hide only our historical evidence provenance label; never rewrite stored evidence.
 * Keep the excerpt warning: a clipped clarification must not look like the full text.
 */
function displayedNoteText(text:string):string{
 const source=/^人工补充\d+（较新说明优先(，此处为摘要，完整内容见角标核对区)?）：/.exec(text);
 if(!source)return text;
 return text.slice(source[0].length)+(source[1]?'（此处为摘要，完整内容见角标核对区）':'');
}
export function diagramConditionLines(annotations:DiagramAnnotation[],notes:DiagramNote[]):string[]{
 return [
  ...annotations.map(a=>a.kind==='angle'?`原图标注 ${a.text}：∠${a.a}${a.vertex}${a.b}（从${a.vertex}${a.a}到${a.vertex}${a.b}${a.direction==='ccw'?'逆时针':'顺时针'}的角区，标记原样保留）`:`原图标注 ${a.text}：线段${a.a}${a.b}`),
  ...notes.map(n=>`${n.status==='uncertain'?'待核对（不作为已知条件）：':''}${displayedNoteText(n.text)}`),
 ];
}
export type LabelLayout={annotation:DiagramAnnotation;x:number;y:number;width:number;path?:string;bounds:Point[];hidden:boolean};
/** Layout uses the already locked screen mapping, never changes source coordinates or scale. */
export function layoutDiagramAnnotations(annotations:DiagramAnnotation[],get:(id:string)=>Point,pointLabels:Array<Point & {id:string}>):LabelLayout[]{
 const occupied=pointLabels.map(p=>({left:p.x-6,top:p.y-31,right:p.x+11+p.id.length*18,bottom:p.y+7}));
 return annotations.map(annotation=>{
  const a=get(annotation.a),b=get(annotation.b),width=Math.max(18,[...annotation.text].length*18);
  let x:number,y:number,path:string|undefined,hidden=false;
  if(annotation.kind==='angle'){
   const v=get(annotation.vertex),start=Math.atan2(a.y-v.y,a.x-v.x),end=Math.atan2(b.y-v.y,b.x-v.x),tau=Math.PI*2,sign=annotation.direction==='ccw'?-1:1;
   const span=(((end-start)*sign)%tau+tau)%tau,mid=start+sign*span/2,r=Math.min(30,Math.hypot(a.x-v.x,a.y-v.y)*.22,Math.hypot(b.x-v.x,b.y-v.y)*.22);
   const p={x:v.x+r*Math.cos(start),y:v.y+r*Math.sin(start)},q={x:v.x+r*Math.cos(end),y:v.y+r*Math.sin(end)};
   path=`M ${p.x} ${p.y} A ${r} ${r} 0 ${span>Math.PI?1:0} ${sign===1?1:0} ${q.x} ${q.y}`;
   const labelR=r+34;x=v.x+labelR*Math.cos(mid);y=v.y+labelR*Math.sin(mid);
   // Very narrow sectors or tiny legs cannot hold a readable label reliably: caption only.
   hidden=r<10||span<Math.PI/12;
  }else{
   const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),side=annotation.side==='right'?-1:1;
   x=(a.x+b.x)/2+side*dy/len*24;y=(a.y+b.y)/2-side*dx/len*24;
  }
  const box={left:x-width/2-4,top:y-14,right:x+width/2+4,bottom:y+14};
  hidden=hidden||occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top);
  if(!hidden)occupied.push(box);
  return {annotation,x,y,width,path,hidden,bounds:hidden?[]:[{x:box.left,y:box.top},{x:box.right,y:box.bottom}]};
 });
}
/** Standalone SVG has no HTML caption, so append safe, wrapped SVG text to a clone. */
export function appendDiagramCaption(svg:SVGSVGElement,lines:string[]){
 if(!lines.length)return;
 const ns='http://www.w3.org/2000/svg';
 const [left,top,oldWidth,height]=svg.getAttribute('viewBox')!.split(/\s+/).map(Number),width=Math.max(320,oldWidth),inset=12,font=16,lineHeight=24;
 const count=Math.max(1,Math.floor((width-inset*2)/font));
 const wrapped=['原图标记与图注（识别结果，请核对原图）',...lines].flatMap(line=>{
  const chars=Array.from(line),out:string[]=[];for(let i=0;i<chars.length;i+=count)out.push(chars.slice(i,i+count).join(''));return out;
 });
 const group=document.createElementNS(ns,'g');group.setAttribute('data-export-caption','true');
 for(const [i,line] of wrapped.entries()){
  const text=document.createElementNS(ns,'text');text.setAttribute('x',String(left+inset));text.setAttribute('y',String(top+height+font+i*lineHeight));text.setAttribute('font-size',String(font));text.setAttribute('font-family','sans-serif');text.setAttribute('fill','#334155');text.textContent=line;group.appendChild(text);
 }
 const totalHeight=height+wrapped.length*lineHeight+inset;
 svg.setAttribute('viewBox',[left,top,width,totalHeight].join(' '));
 const background=svg.querySelector('rect');background?.setAttribute('height',String(totalHeight));background?.setAttribute('width',String(width));svg.appendChild(group);
}
