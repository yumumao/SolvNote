import {reflowMathLines,resetMathLines} from './math-line-wrap';

/** Same measured, reversible layout pass for live reading and detached PNG pages. */
export function fitMarkdownWidth(container: HTMLElement): void {
 const roots = container.matches('[data-markdown-fit]') ? [container] : Array.from(container.querySelectorAll<HTMLElement>('[data-markdown-fit]'));
 for (const root of roots) {
  const maths = Array.from(root.querySelectorAll<HTMLElement>('.katex'));
  maths.forEach(resetMathLines);
  if (root.dataset.markdownFit !== 'true' || root.clientWidth <= 0) continue;
  for (const math of maths) {
   // Lists/tables may offer less space than the full Markdown column.
   const block = math.closest<HTMLElement>('.katex-display, p, li, td, th') || root;
   const style = getComputedStyle(block);
   const available = Math.min(root.clientWidth, block.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
   const html = math.querySelector<HTMLElement>(':scope > .katex-html');
   const bases = html ? Array.from(html.children) as HTMLElement[] : [];
   // Inline KaTeX may already wrap *after* '=' and report only the fitted width.
   // Sum its intact top-level bases to detect that case and reflow before '='.
   const unwrapped = bases.length && bases.every(base=>base.classList.contains('base'))
    ? bases.reduce((width,base)=>width+base.getBoundingClientRect().width,0) : 0;
   const natural = Math.max(math.scrollWidth, math.getBoundingClientRect().width, unwrapped);
   if (available > 0 && natural > available + 1 && !reflowMathLines(math, available)) {
    // Unsplittable structures stay legible, with local horizontal scrolling.
    math.dataset.mathOverflow='true';
   }
  }
 }
}
/** PNG cannot scroll: widen only for an indivisible formula, never silently clip. */
export function fitMarkdownImagePage(page: HTMLElement, initialWidth: number): number {
 let width=initialWidth;
 for(let pass=0;pass<4;pass++){
  page.style.width=`${width}px`;fitMarkdownWidth(page);
  const overflow=Math.max(0,...Array.from(page.querySelectorAll<HTMLElement>('[data-math-overflow]')).map(math=>math.scrollWidth-math.clientWidth));
  if(overflow<=1)return width;
  width+=Math.ceil(overflow)+2;
  if(width>2048)break;
 }
 throw Error('某条公式无法在可读字号下安全换行，请手动分行，或使用LaTeX文字分享。');
}
/** The exported bitmap follows the current reading width only when explicitly selected. */
export function solutionImageWidth(source: HTMLElement): number {
 if (source.dataset.fitWidth !== 'true') return 760;
 return Math.min(2048, Math.max(160, Math.round(source.getBoundingClientRect().width || source.clientWidth || 760)));
}
