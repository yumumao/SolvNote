/** Share the same layout pass between live reading and detached PNG pages. */
export function fitMarkdownWidth(container: HTMLElement): void {
 const roots = container.matches('[data-markdown-fit]') ? [container] : Array.from(container.querySelectorAll<HTMLElement>('[data-markdown-fit]'));
 for (const root of roots) {
  const maths = Array.from(root.querySelectorAll<HTMLElement>('.katex'));
  maths.forEach(math => math.style.removeProperty('font-size'));
  if (root.dataset.markdownFit !== 'true' || root.clientWidth <= 0) continue;
  for (const math of maths) {
   // Lists/tables may offer less space than the full Markdown column.
   const block = math.closest<HTMLElement>('.katex-display, p, li, td, th') || root;
   const style = getComputedStyle(block);
   const available = Math.min(root.clientWidth, block.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0'));
   const natural = Math.max(math.scrollWidth, math.getBoundingClientRect().width);
   if (available > 0 && natural > available) {
    const size = parseFloat(getComputedStyle(math).fontSize);
    if (size > 0) math.style.fontSize = `${size * (available - 1) / natural}px`;
   }
  }
 }
}
/** The exported bitmap follows the current reading width only when explicitly selected. */
export function solutionImageWidth(source: HTMLElement): number {
 if (source.dataset.fitWidth !== 'true') return 760;
 return Math.min(2048, Math.max(160, Math.round(source.getBoundingClientRect().width || source.clientWidth || 760)));
}
