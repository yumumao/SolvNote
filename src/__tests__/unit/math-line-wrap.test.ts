import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import katex from 'katex';
import {fitMarkdownWidth,solutionImageWidth} from '@/lib/markdown-fit';
import {solutionPlainText} from '@/lib/solution-share';

let root:HTMLDivElement,available:number;
// jsdom has no layout. Use deterministic atom widths; real fonts/layout are covered in Chromium.
function width(node:Element):number {
 if(node.classList.contains('katex-mathml')||node.classList.contains('strut'))return 0;
 if(node.classList.contains('mspace'))return 5;
 if(node.classList.contains('katex'))return width(node.querySelector('[data-math-lines]')||node.querySelector('.katex-html')!);
 if(node.hasAttribute('data-math-lines'))return Math.max(...Array.from(node.children).map(width));
 if(node.childElementCount)return Array.from(node.children).reduce((n,c)=>n+width(c),0)+parseFloat((node as HTMLElement).style.paddingLeft||'0');
 return (node.textContent?.length||0)*12;
}
beforeEach(()=>{
 available=135;root=document.createElement('div');root.dataset.markdownFit='true';root.style.fontSize='20px';document.body.append(root);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this===root||this.matches('p,li,td,.katex-display')?available:width(this)});
 vi.spyOn(HTMLElement.prototype,'scrollWidth','get').mockImplementation(function(this:HTMLElement){return width(this)});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {width:width(this),height:24,x:0,y:0,left:0,top:0,right:width(this),bottom:24,toJSON(){return {}}} as DOMRect});
});
afterEach(()=>{root.remove();vi.restoreAllMocks()});
function render(tex:string,displayMode=true){root.innerHTML=katex.renderToString(tex,{displayMode});const math=root.querySelector<HTMLElement>('.katex')!;math.style.fontSize='20px';return math}
const lines=()=>Array.from(root.querySelectorAll<HTMLElement>('[data-math-line]'));
it('wraps a long equality chain before relations without shrinking or changing original LaTeX',()=>{
 const tex=String.raw`A=12345=67890=12345`;const math=render(tex);const original=math.querySelector('.katex-html')!.innerHTML;
 fitMarkdownWidth(root);
 expect(lines().length).toBeGreaterThan(1);expect(lines().slice(1).every(l=>l.textContent?.trim().startsWith('='))).toBe(true);
 expect(math.style.fontSize).toBe('');expect(math.querySelector('annotation')?.textContent).toBe(tex);
 expect(math.querySelector('.katex-html:not([data-math-lines])')!.innerHTML).toBe(original);
 expect(solutionPlainText(root)).toContain(tex);expect(root.querySelectorAll('annotation')).toHaveLength(1);
});
it('uses plus/minus only when a single equality step is too wide',()=>{
 render('y=12345+67890-12345');fitMarkdownWidth(root);
 expect(lines().length).toBeGreaterThan(1);expect(lines().some(l=>/^[+−-]/.test(l.textContent!.trim()))).toBe(true);
});
it('does not split a fraction, radical, parenthesized expression or matrix internally',()=>{
 for(const tex of [String.raw`\frac{12345+67890}{12345+67890}`,String.raw`\sqrt{12345+67890}`,String.raw`(12345+67890)`,String.raw`\begin{pmatrix}12345&67890\\12345&67890\end{pmatrix}`]){
  const math=render(tex);fitMarkdownWidth(root);expect(lines()).toHaveLength(0);expect(math.style.fontSize).toBe('');expect(math.dataset.mathOverflow).toBe('true');
 }
});
it('preserves author-specified aligned equations rather than flattening their rows',()=>{
 const math=render(String.raw`\begin{aligned}x&=1234567890\\&=2345678901\end{aligned}`);const original=math.innerHTML;fitMarkdownWidth(root);
 expect(lines()).toHaveLength(0);expect(math.innerHTML).toBe(original);expect(math.dataset.mathOverflow).toBe('true');
});
it('is repeatable, recalculates clones for PNG widths and restores original layout when disabled',()=>{
 const math=render('A=12345=67890=12345');fitMarkdownWidth(root);const count=lines().length;
 expect(count).toBeGreaterThan(1);fitMarkdownWidth(root);expect(lines()).toHaveLength(count);
 const clone=root.cloneNode(true) as HTMLElement;root.append(clone);fitMarkdownWidth(clone);expect(clone.querySelectorAll('[data-math-lines]')).toHaveLength(1);clone.remove();
 root.dataset.markdownFit='false';fitMarkdownWidth(root);expect(lines()).toHaveLength(0);expect(math.dataset.mathReflow).toBeUndefined();expect(math.dataset.mathOverflow).toBeUndefined();
});
it('restores full-size single lines on a wider screen and leaves ordinary formulas untouched',()=>{
 const math=render('A=12345=67890=12345');fitMarkdownWidth(root);expect(lines().length).toBeGreaterThan(1);
 available=1000;fitMarkdownWidth(root);expect(lines()).toHaveLength(0);expect(math.style.fontSize).toBe('');
 render('x=1');fitMarkdownWidth(root);expect(lines()).toHaveLength(0);
});
it('also reflows an oversized inline formula without adding another semantic copy',()=>{
 render('A=12345=67890=12345',false);fitMarkdownWidth(root);expect(lines().length).toBeGreaterThan(1);expect(root.querySelectorAll('math')).toHaveLength(1);
});
it('keeps export width preference unchanged',()=>{
 expect(solutionImageWidth(root)).toBe(760);root.dataset.fitWidth='true';expect(solutionImageWidth(root)).toBeGreaterThanOrEqual(160);
});

it('reflows inline math even when native KaTeX bases already wrap after equals',()=>{
 const math=render('A=12345=67890=12345',false);
 Object.defineProperty(math,'scrollWidth',{configurable:true,value:available});
 Object.defineProperty(math,'getBoundingClientRect',{configurable:true,value:()=>({width:available} as DOMRect)});
 fitMarkdownWidth(root);expect(lines().length).toBeGreaterThan(1);
 expect(lines().slice(1).every(l=>l.textContent?.trim().startsWith('='))).toBe(true);
});
it('keeps nested relations, text content and explicit breaks out of automatic splitting',()=>{
 for(const tex of [String.raw`\left(12345=67890\right)`,String.raw`\text{12345=67890=12345}`,String.raw`a=1234567890\\b=1234567890`]){
  render(tex);fitMarkdownWidth(root);expect(lines()).toHaveLength(0);
 }
});
it('places relation signs at aligned continuation indents',()=>{
 render('x=12345=67890=12345');fitMarkdownWidth(root);
 expect(lines().length).toBeGreaterThan(1);
 expect(new Set(lines().slice(1).map(line=>line.style.paddingLeft)).size).toBe(1);
});
