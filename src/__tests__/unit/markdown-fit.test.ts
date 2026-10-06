import {afterEach,it,expect,vi} from 'vitest';
import {fitMarkdownWidth,fitMarkdownImagePage,solutionImageWidth} from '@/lib/markdown-fit';
import {renderSolutionImages} from '@/lib/solution-images';
import {toBlob} from 'html-to-image';
vi.mock('html-to-image',()=>({toBlob:vi.fn(async()=>new Blob(['synthetic'],{type:'image/png'}))}));
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.clearAllMocks()});
it('preserves readable wide math and restores scrolling markers when disabled or resized',()=>{
 const root=document.createElement('div');root.dataset.markdownFit='true';root.innerHTML='<div class="katex-display"><span class="katex" style="font-family:serif">formula</span></div>';
 document.body.append(root);const block=root.firstElementChild as HTMLElement,math=block.firstElementChild as HTMLElement;
 Object.defineProperty(root,'clientWidth',{configurable:true,value:300});Object.defineProperty(block,'clientWidth',{value:300});Object.defineProperty(math,'scrollWidth',{value:600});
 vi.spyOn(window,'getComputedStyle').mockImplementation(()=>({fontSize:'20px',paddingLeft:'0',paddingRight:'0'}) as CSSStyleDeclaration);
 fitMarkdownWidth(root);expect(math.style.fontSize).toBe('');expect(math.dataset.mathOverflow).toBe('true');expect(math.style.fontFamily).toBe('serif');
 root.dataset.markdownFit='false';fitMarkdownWidth(root);expect(math.style.fontSize).toBe('');expect(math.dataset.mathOverflow).toBeUndefined();
 root.dataset.markdownFit='true';Object.defineProperty(root,'clientWidth',{value:0});fitMarkdownWidth(root);expect(math.style.fontSize).toBe('');
});
it('retains 760px normal exports and follows the actual narrow reader width in fit mode',()=>{
 const source=document.createElement('article');vi.spyOn(source,'getBoundingClientRect').mockReturnValue({width:278} as DOMRect);
 expect(solutionImageWidth(source)).toBe(760);source.dataset.fitWidth='true';expect(solutionImageWidth(source)).toBe(278);
});
it('PNG export uses the current fit width without mutating the source and cleans up its temporary host',async()=>{
 const fontDescriptor=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 try{
  const source=document.createElement('article');source.dataset.fitWidth='true';source.innerHTML='<h1>合成</h1><p>本地内容</p>';document.body.append(source);
  vi.spyOn(source,'getBoundingClientRect').mockReturnValue({width:286} as DOMRect);const before=source.outerHTML;
  const images=await renderSolutionImages(source);expect(images).toHaveLength(1);expect(toBlob).toHaveBeenCalledWith(expect.any(HTMLElement),expect.objectContaining({width:286,pixelRatio:1.5}));
  expect(source.outerHTML).toBe(before);expect(document.body.children).toHaveLength(1);
  vi.mocked(toBlob).mockRejectedValueOnce(Error('synthetic export failure'));
  await expect(renderSolutionImages(source)).rejects.toThrow('synthetic export failure');expect(document.body.children).toHaveLength(1);
 }finally{if(fontDescriptor)Object.defineProperty(document,'fonts',fontDescriptor);else Reflect.deleteProperty(document,'fonts')}
});

it('PNG widens only an indivisible formula, never clips it or shrinks the font',()=>{
 const page=document.createElement('article');page.innerHTML='<div data-markdown-fit="true"><div class="katex-display"><span class="katex">indivisible</span></div></div>';document.body.append(page);
 const root=page.firstElementChild as HTMLElement,block=root.firstElementChild as HTMLElement,math=block.firstElementChild as HTMLElement;
 for(const node of [root,block,math])Object.defineProperty(node,'clientWidth',{get:()=>parseFloat(page.style.width)-32});
 Object.defineProperty(math,'scrollWidth',{configurable:true,get:()=>720});
 const result=fitMarkdownImagePage(page,300);expect(result).toBeGreaterThanOrEqual(752);expect(result).toBeLessThan(760);expect(math.style.fontSize).toBe('');expect(math.dataset.mathOverflow).toBeUndefined();
 Object.defineProperty(math,'scrollWidth',{get:()=>3000});
 expect(()=>fitMarkdownImagePage(page,300)).toThrow('无法在可读字号下安全换行');
});
