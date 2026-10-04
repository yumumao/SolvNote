import {fitMarkdownWidth,solutionImageWidth} from "./markdown-fit";
import { toBlob } from "html-to-image";
import {localSolutionImage} from "./solution-snapshot";
import { localStyleText, solutionUnits } from "./solution-share";
export interface SolutionImage { blob: Blob; name: string }
/** Embed local KaTeX fonts only; no remote stylesheet, image or upload is allowed. */
async function embedFonts(element:HTMLElement):Promise<string>{
 const families=new Set(Array.from(element.querySelectorAll('*')).map(e=>getComputedStyle(e).fontFamily));
 const rules=localStyleText().match(/@font-face\s*\{[^}]+\}/g)||[];
 const wanted=rules.filter(rule=>Array.from(families).some(f=>{const name=/font-family:\s*["']?([^;"'}]+)/.exec(rule)?.[1]?.trim();return name&&f.includes(name)}));
 return (await Promise.all(wanted.map(async rule=>{
  const urls=Array.from(rule.matchAll(/url\("([^\"]+)"\)\s*format\("woff2"\)/g));
  if(!urls.length)return '';
  const url=new URL(urls[0][1]);if(url.origin!==location.origin)return '';
  const response=await fetch(url.href,{credentials:'same-origin',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('公式字体读取失败，请刷新后重试。');
  const blob=await response.blob();const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(blob)});
  return rule.replace(/src:[^;]+;/,`src: url("${data}") format("woff2");`);
 }))).join('\n');
}
/** Decode local raster attachments before measuring/paginating; a missing picture is an error. */
export async function waitForSolutionImages(element:HTMLElement):Promise<void>{
 await Promise.all(Array.from(element.querySelectorAll('img')).map(async image=>{
  if(!localSolutionImage(image.getAttribute('src')))throw Error('分享图片必须是本地PNG/JPEG/WebP。');
  await new Promise<void>((resolve,reject)=>{
   const finish=(error?:Error)=>{clearTimeout(timer);image.removeEventListener('load',load);image.removeEventListener('error',fail);if(error)reject(error);else resolve()};
   const load=()=>finish(image.naturalWidth?undefined:Error('原图无法读取，请重新选择图片。'));
   const fail=()=>finish(Error('原图无法读取，请重新选择图片。'));
   const timer=setTimeout(()=>finish(Error('原图加载超时，请重试。')),15000);
   image.addEventListener('load',load);image.addEventListener('error',fail);if(image.complete)load();
  });
  if(image.decode)await image.decode().catch(()=>{throw Error('原图解码失败，请重新选择图片。')});
 }));
}
export async function renderSolutionImages(source:HTMLElement):Promise<SolutionImage[]>{
 const fit=source.dataset.fitWidth==='true',initialWidth=solutionImageWidth(source);
 const host=document.createElement('div');host.style.cssText=`position:fixed;left:-100000px;top:0;width:${initialWidth}px;pointer-events:none;`;document.body.append(host);
 try{
  const page=source.cloneNode(false) as HTMLElement;page.style.width=initialWidth+'px';page.style.maxWidth='none';page.style.boxSizing='border-box';host.append(page);
  await document.fonts.ready;
  const units=solutionUnits(source),groups:HTMLElement[][]=[];let group:HTMLElement[]=[];
  for(let i=0;i<units.length;i++){
   const heading=(node:HTMLElement)=>/^H[1-6]$/.test(node.tagName)||(node.children.length===1&&/^H[1-6]$/.test(node.firstElementChild!.tagName));
   const chunk=[units[i]];while(heading(units[i])&&i+1<units.length)chunk.push(units[++i]);
   page.append(...chunk);
   await waitForSolutionImages(page);
   if(fit)fitMarkdownWidth(page);
   if(page.scrollHeight>1800&&group.length){groups.push(group);page.replaceChildren(...chunk);group=[]}
   group.push(...chunk);
  }
  if(group.length)groups.push(group);
  if(groups.length>32)throw Error('内容过长，请按章节分别分享，或使用文字分享。');
  // Measure/export sequentially, never allocate one unbounded full-length canvas.
  const images:SolutionImage[]=[];
  page.replaceChildren(...units.map(n=>n.cloneNode(true)));
  await document.fonts.ready;
  await waitForSolutionImages(page);
  const fontEmbedCSS=await embedFonts(page);
  for(let i=0;i<groups.length;i++){
   page.replaceChildren(...groups[i]);page.style.width=initialWidth+'px';
   await waitForSolutionImages(page);
   if(fit)fitMarkdownWidth(page);
   let width=initialWidth;
   if(!fit)page.querySelectorAll<HTMLElement>('.katex-display,pre,table').forEach(n=>{width=Math.max(width,n.scrollWidth+100)});
   if(width>2048)throw Error('某条公式或表格过宽，请分行后导出，或使用文字分享。');
   page.style.width=width+'px';
   const height=page.scrollHeight;
   if(height>4096)throw Error('单个步骤过长，请分段后导出，或使用文字分享。');
   const blob=await toBlob(page,{backgroundColor:'#fff',pixelRatio:1.5,width,height,fontEmbedCSS,cacheBust:false});
   if(!blob||!blob.size)throw Error('图片生成失败，请重试或使用文字分享。');
   images.push({blob,name:`solvnote-solution-${i+1}.png`});
  }
  return images;
 }finally{host.remove()}
}
