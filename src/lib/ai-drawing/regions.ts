import {z} from 'zod';
const id=z.string().regex(/^[A-Z][0-9]{0,3}$/);
const edge=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('segment'),to:id}).strict(),
 z.object({kind:z.literal('arc'),center:id,to:id,direction:z.enum(['ccw','cw'])}).strict(),
]);
/** Closed original boundaries only, never arbitrary SVG, CSS or executable commands. */
export const DiagramRegionSchema=z.object({contours:z.array(z.object({start:id,edges:z.array(edge).min(1).max(24)}).strict()).min(1).max(4)}).strict();
export type DiagramRegion=z.infer<typeof DiagramRegionSchema>;
type Point={x:number;y:number};
type RegionEdge={kind:'segment';to:Point}|{kind:'arc';to:Point;center:Point;radius:number;span:number;direction:'ccw'|'cw'};
export type CompiledRegion={contours:Array<{start:Point;edges:RegionEdge[]}>;bounds:Point[]};
const tau=2*Math.PI;
export function compileDiagramRegions(regions:DiagramRegion[],get:(id:string)=>Point):CompiledRegion[]{
 const bad=():never=>{throw Error('INVALID_CONSTRUCTION');};
 return regions.map(region=>{
  const bounds:Point[]=[];
  const contours=region.contours.map(contour=>{
   const start=get(contour.start);let from=start,area=0;
   const edges:RegionEdge[]=contour.edges.map(e=>{
    const to=get(e.to);bounds.push(from,to);
    let result:RegionEdge;
    if(e.kind==='segment'){
     if(Math.hypot(to.x-from.x,to.y-from.y)<1e-6)bad();
     area+=from.x*to.y-to.x*from.y;result={kind:'segment',to};
    }else{
     const center=get(e.center),radius=Math.hypot(from.x-center.x,from.y-center.y),endRadius=Math.hypot(to.x-center.x,to.y-center.y);
     if(radius<1e-6||Math.abs(radius-endRadius)>radius*1e-4)bad();
     const a=Math.atan2(from.y-center.y,from.x-center.x),b=Math.atan2(to.y-center.y,to.x-center.x),sign=e.direction==='ccw'?1:-1;
     const span=((sign*(b-a))%tau+tau)%tau || tau;
     area+=center.x*(to.y-from.y)-center.y*(to.x-from.x)+sign*radius*radius*span;
     for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])if(((sign*(angle-a))%tau+tau)%tau<=span+1e-9)bounds.push({x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)});
     result={kind:'arc',to,center,radius,span,direction:e.direction};
    }
    from=to;return result;
   });
   if(contour.edges.at(-1)!.to!==contour.start||Math.abs(area)<1e-10)bad();
   return {start,edges};
  });
  return {contours,bounds};
 });
}
/** evenodd preserves holes; full circles need two SVG arcs with distinct endpoints. */
export function diagramRegionPath(region:CompiledRegion,map:(p:Point)=>Point,scale:number):string{
 return region.contours.map(c=>{
  const start=map(c.start);let from=c.start;const parts=[`M ${start.x} ${start.y}`];
  for(const e of c.edges){
   const to=map(e.to);
   if(e.kind==='segment')parts.push(`L ${to.x} ${to.y}`);
   else{
    const r=e.radius*scale,sweep=e.direction==='cw'?1:0;
    if(e.span>=tau-1e-8){const mid=map({x:2*e.center.x-from.x,y:2*e.center.y-from.y});parts.push(`A ${r} ${r} 0 1 ${sweep} ${mid.x} ${mid.y}`);}
    parts.push(`A ${r} ${r} 0 ${e.span>Math.PI?1:0} ${sweep} ${to.x} ${to.y}`);
   }
   from=e.to;
  }
  return parts.join(' ')+' Z';
 }).join(' ');
}
