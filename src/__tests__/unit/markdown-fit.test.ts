import {afterEach,it,expect,vi} from 'vitest';
import {fitMarkdownWidth,solutionImageWidth} from '@/lib/markdown-fit';
import {renderSolutionImages} from '@/lib/solution-images';
import {toBlob} from 'html-to-image';
vi.mock('html-to-image',()=>({toBlob:vi.fn(async()=>new Blob(['synthetic'],{type:'image/png'}))}));
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.clearAllMocks()});
it('scales only wide math and restores the normal font when disabled or resized',()=>{
 const root=document.createElement('div');root.dataset.markdownFit='true';root.innerHTML='<div class="katex-display"><span class="katex" style="font-family:serif">formula</span></div>';
 document.body.append(root);const block=root.firstElementChild as HTMLElement,math=block.firstElementChild as HTMLElement;
 Object.defineProperty(root,'clientWidth',{configurable:true,value:300});Object.defineProperty(block,'clientWidth',{value:300});Object.defineProperty(math,'scrollWidth',{value:600});
 vi.spyOn(window,'getComputedStyle').mockImplementation(()=>({fontSize:'20px',paddingLeft:'0',paddingRight:'0'}) as CSSStyleDeclaration);
 fitMarkdownWidth(root);expect(parseFloat(math.style.fontSize)).toBeLessThan(10);expect(math.style.fontFamily).toBe('serif');
 root.dataset.markdownFit='false';fitMarkdownWidth(root);expect(math.style.fontSize).toBe('');
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
