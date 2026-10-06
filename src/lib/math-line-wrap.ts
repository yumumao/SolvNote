/** Reflow only top-level KaTeX atoms. Never parse/rewrite the user's TeX or split
 * fractions, radicals, scripts, arrays, fenced groups, or author-defined rows. */
interface Atom { element: HTMLElement; strut: HTMLElement | null; width: number }
interface Break { index: number; kind: 'relation' | 'binary' }
interface Line { start: number; end: number; indent: number }
const px = (value: string) => parseFloat(value) || 0;
const space = (atom: Atom) => atom.element.classList.contains('mspace');

function atomsAndBreaks(html: HTMLElement): { atoms: Atom[]; breaks: Break[] } | null {
 const bases = Array.from(html.children) as HTMLElement[];
 if (!bases.length || bases.some(base => !base.classList.contains('base')) || html.querySelector('.newline,.nobreak,.tag')) return null;
 const atoms: Atom[] = [];
 for (const base of bases) {
  const strut = base.querySelector<HTMLElement>(':scope > .strut');
  for (const element of Array.from(base.children) as HTMLElement[]) {
   if (element.classList.contains('strut')) continue;
   const style = getComputedStyle(element);
   atoms.push({ element, strut, width: element.getBoundingClientRect().width + px(style.marginLeft) + px(style.marginRight) });
  }
 }
 // Bound the quadratic planner on pathological/very large formulas.
 if (atoms.length > 512) return null;
 const breaks: Break[] = [];
 let depth = 0, previous: HTMLElement | undefined;
 for (let index = 0; index < atoms.length; index++) {
  const {element} = atoms[index];
  if (space(atoms[index])) continue;
  if (element.classList.contains('mclose')) depth--;
  if (depth < 0) return null;
  if (depth === 0 && previous && index < atoms.length - 1) {
   if (element.classList.contains('mrel') && !previous.classList.contains('mrel')) breaks.push({index, kind:'relation'});
   else if (element.classList.contains('mbin') && /^[+−-]$/.test(element.textContent || '')) breaks.push({index, kind:'binary'});
  }
  if (element.classList.contains('mopen')) depth++;
  previous = element;
 }
 return depth === 0 && breaks.length ? {atoms, breaks} : null;
}

function trim(atoms: Atom[], start: number, end: number): [number, number] {
 while (start < end && space(atoms[start])) start++;
 while (end > start && space(atoms[end-1])) end--;
 return [start,end];
}
function plan(atoms: Atom[], breaks: Break[], available: number, indent: number): Line[] | null {
 const sums=[0];for (const atom of atoms) sums.push(sums.at(-1)!+atom.width);
 const points=[{index:0,kind:'relation'},...breaks,{index:atoms.length,kind:'relation'}];
 const scores=Array<number>(points.length).fill(Infinity),next=Array<number>(points.length).fill(-1);
 scores[points.length-1]=0;
 for(let i=points.length-2;i>=0;i--){
  const room=available-(i===0?0:indent);
  for(let j=i+1;j<points.length;j++){
   const [start,end]=trim(atoms,points[i].index,points[j].index),width=sums[end]-sums[start];
   if(width>room)continue;
   // Prefer relation/equality boundaries; use +/- only when a step cannot fit.
   const score=scores[j]+1+(points[j].kind==='binary'?12:0)+0.05*((room-width)/available)**2;
   if(score<scores[i]){scores[i]=score;next[i]=j;}
  }
 }
 if(next[0]<0)return null;
 const lines:Line[]=[];
 for(let i=0;i<points.length-1;){const j=next[i];const [start,end]=trim(atoms,points[i].index,points[j].index);lines.push({start,end,indent:i===0?0:indent});i=j;}
 return lines.length>1?lines:null;
}

export function resetMathLines(math: HTMLElement): void {
 math.querySelectorAll(':scope > [data-math-lines]').forEach(node=>node.remove());
 delete math.dataset.mathReflow;delete math.dataset.mathOverflow;
 // Remove shrinking from old live nodes / exported clones as well.
 math.style.removeProperty('font-size');
}

export function reflowMathLines(math: HTMLElement, available: number): boolean {
 const html=math.querySelector<HTMLElement>(':scope > .katex-html');
 if(!html)return false;
 const input=atomsAndBreaks(html);if(!input)return false;
 const {atoms,breaks}=input;
 const relation=breaks.find(b=>b.kind==='relation');
 const lhs=relation?atoms.slice(0,relation.index).reduce((n,a)=>n+a.width,0):0;
 const size=px(getComputedStyle(math).fontSize)||18;
 const indent=lhs>0&&lhs<available*.3?lhs:Math.min(size,available*.08);
 const lines=plan(atoms,breaks,available-2,indent)||plan(atoms,breaks,available-2,0);
 if(!lines)return false;
 const result=document.createElement('span');result.className='katex-html';result.dataset.mathLines='true';result.setAttribute('aria-hidden','true');
 for(const line of lines){
  const row=document.createElement('span');row.className='base';row.dataset.mathLine='true';row.style.paddingLeft=`${line.indent}px`;
  const struts=new Set<HTMLElement>();
  for(const atom of atoms.slice(line.start,line.end)){
   // Preserve original vertical extents (fraction/radical baselines).
   if(atom.strut&&!struts.has(atom.strut)){struts.add(atom.strut);row.append(atom.strut.cloneNode(true));}
   row.append(atom.element.cloneNode(true));
  }
  result.append(row);
 }
 math.append(result);math.dataset.mathReflow='true';
 // Real font metrics are authoritative. On unexpected KaTeX markup, keep the
 // untouched original rather than clipping or guessing a smaller font size.
 if(Array.from(result.children).some(row=>row.getBoundingClientRect().width>available+1)){
  result.remove();delete math.dataset.mathReflow;return false;
 }
 return true;
}
