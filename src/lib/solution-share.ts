/** Local DOM utilities. No AI, persistence, public URL or upload API. */
export interface SolutionTextOptions { includeLatex?: boolean }
/** KaTeX's semantic MathML is safer to approximate than stripping TeX commands. */
function readableMath(node: Element): string {
 const children = Array.from(node.children).filter(child => child.localName !== 'annotation');
 const parts = children.map(readableMath);
 switch (node.localName) {
  case 'annotation': return '';
  case 'semantics': return parts[0] || '';
  case 'mfrac': return `(${parts[0] || '?'})/(${parts[1] || '?'})`;
  case 'msqrt': return `√(${parts.join('')})`;
  case 'mroot': return `root[${parts[1] || '?'}](${parts[0] || '?'})`;
  case 'msup': return `${parts[0]}^(${parts[1]})`;
  case 'msub': return `${parts[0]}_(${parts[1]})`;
  case 'msubsup': return `${parts[0]}_(${parts[1]})^(${parts[2]})`;
  case 'mover': return `${parts[0]}（上方：${parts[1]}）`;
  case 'munder': return `${parts[0]}（下方：${parts[1]}）`;
  case 'munderover': return `${parts[0]}（下方：${parts[1]}；上方：${parts[2]}）`;
  case 'mtable': return parts.join('; ');
  case 'mtr': return parts.join(', ');
  default: return children.length ? parts.join('') : (node.textContent || '').replace(/[\u2061-\u2064]/g, ' ');
 }
}
export function solutionPlainText(element: HTMLElement, options: SolutionTextOptions = {}): string {
 const clone=element.cloneNode(true) as HTMLElement;
 clone.querySelectorAll('.katex').forEach(math=>{
  const source=math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  const semantic=math.querySelector('math');
  const text=options.includeLatex!==false ? (source||math.textContent||'') : `${semantic?readableMath(semantic):'（公式未能转换）'}（公式显示可能不准确，建议使用图片或LaTeX分享）`;
  math.replaceWith(document.createTextNode(text));
 });
 if(options.includeLatex===false)clone.querySelectorAll('.katex-error').forEach(math=>math.replaceWith(document.createTextNode('（公式未能转换；公式显示可能不准确，建议使用图片或LaTeX分享）')));
 clone.querySelectorAll('[data-solution-attachment]').forEach(node=>node.replaceWith(document.createTextNode('\n[图片：'+node.getAttribute('data-solution-attachment')+']（图片需通过图片分享）\n')));
 const prefixListItem=(li:Element,label:string)=>{
  // react-markdown loose lists start with formatting whitespace and a paragraph.
  // Put the marker inside that first paragraph, not on its own line before it.
  const paragraph=li.firstElementChild?.tagName==='P'?li.firstElementChild:li;
  while(paragraph.firstChild?.nodeType===Node.TEXT_NODE&&!paragraph.firstChild.textContent?.trim())paragraph.firstChild.remove();
  paragraph.prepend(document.createTextNode(label));
 };
 clone.querySelectorAll('ol').forEach(list=>{const start=Number(list.getAttribute('start'))||1;Array.from(list.children).forEach((li,i)=>prefixListItem(li,`${start+i}. `))});
 clone.querySelectorAll('ul > li').forEach(li=>prefixListItem(li,'• '));
 clone.querySelectorAll('br').forEach(br=>br.replaceWith(document.createTextNode('\n')));
 clone.querySelectorAll('th,td').forEach(cell=>cell.append(document.createTextNode('\t')));
 clone.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,section,footer,.katex-display').forEach(node=>node.append(document.createTextNode('\n')));
 return (clone.textContent||'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function localStyleText(): string {
 const parts:string[]=[];
 for(const sheet of Array.from(document.styleSheets)){
  if(sheet.href&&new URL(sheet.href,location.href).origin!==location.origin)continue;
  try{for(const rule of Array.from(sheet.cssRules)){
   if(rule.type===CSSRule.IMPORT_RULE)continue;
   parts.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_match,url:string)=>{
    const resolved=new URL(url,sheet.href||location.href);
    return resolved.origin===location.origin||resolved.protocol==='data:'?`url("${resolved.href}")`:'url("")';
   }));
  }}catch{/* Only readable, same-origin app styles are copied. */}
 }
 return parts.join('\n');
}
export function saveBlob(blob: Blob,name: string): void {
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function solutionUnits(element: HTMLElement): HTMLElement[] {
 const units:HTMLElement[]=[];
 for(const child of Array.from(element.children)){
  if(child.hasAttribute('data-solution-section')){
   for(const inner of Array.from(child.children)){
    if(inner.classList.contains('markdown-content')){
     for(const block of Array.from(inner.children)){
      if(block.matches('ol,ul'))Array.from(block.children).forEach((li,index)=>{const list=block.cloneNode(false) as HTMLElement;if(block.tagName==='OL')list.setAttribute('start',String((Number(block.getAttribute('start'))||1)+index));list.append(li.cloneNode(true));const wrapper=inner.cloneNode(false) as HTMLElement;wrapper.append(list);units.push(wrapper)});
      else{const wrapper=inner.cloneNode(false) as HTMLElement;wrapper.append(block.cloneNode(true));units.push(wrapper)}
     }
    }else units.push(inner.cloneNode(true) as HTMLElement);
   }
  }else units.push(child.cloneNode(true) as HTMLElement);
 }
 return units;
}
