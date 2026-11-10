import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {InstallApp} from '@/components/install-app';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Install UI must not call APIs');}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(language:'zh'|'en'='zh'){await act(async()=>root.render(<InstallApp language={language}/>));}
function nativePrompt(outcome:'accepted'|'dismissed'='accepted'){
 const prompt=vi.fn().mockResolvedValue(undefined),event=new Event('beforeinstallprompt',{cancelable:true});
 Object.assign(event,{prompt,userChoice:Promise.resolve({outcome,platform:'web'})});return {prompt,event};
}
describe('optional app installation',()=>{
 it('offers Android and iPhone guidance without opening a prompt or calling an API',async()=>{
  await mount();expect(host.querySelector('summary')?.textContent).toBe('安装应用');expect(host.querySelector('details')?.open).toBe(false);
  expect(host.textContent).toContain('Safari');expect(host.textContent).toContain('添加到主屏幕');expect(host.textContent).toContain('Chrome');expect(host.textContent).toContain('联网');
  expect(fetch).not.toHaveBeenCalled();
 });
 it('only prompts after a user click and uses each native prompt once',async()=>{
  await mount();const {prompt,event}=nativePrompt();await act(async()=>window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);expect(prompt).not.toHaveBeenCalled();
  expect(host.querySelector('button')?.textContent).toContain('安装到设备');
  await act(async()=>{host.querySelector('button')!.click();host.querySelector('button')?.click();});
  expect(prompt).toHaveBeenCalledTimes(1);expect(host.querySelector('button')).toBeNull();expect(fetch).not.toHaveBeenCalled();
  await act(async()=>window.dispatchEvent(new Event('appinstalled')));expect(host.textContent).toBe('');
 });
 it('keeps instructions after dismissal and permits a later fresh browser event',async()=>{
  await mount();const first=nativePrompt('dismissed');await act(async()=>window.dispatchEvent(first.event));
  await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain('取消');expect(host.textContent).toContain('Safari');
  const second=nativePrompt();await act(async()=>window.dispatchEvent(second.event));await act(async()=>host.querySelector('button')!.click());
  expect(first.prompt).toHaveBeenCalledTimes(1);expect(second.prompt).toHaveBeenCalledTimes(1);
 });
 it('handles a rejected native prompt without exposing raw errors',async()=>{
  await mount();const {prompt,event}=nativePrompt();prompt.mockRejectedValue(new Error('private-browser-error'));await act(async()=>window.dispatchEvent(event));
  await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain('浏览器菜单');expect(host.textContent).not.toContain('private-browser-error');
 });
 it('has English guidance',async()=>{await mount('en');expect(host.textContent).toContain('Install app');expect(host.textContent).toContain('Add to Home Screen');});
 it('hides the entry in standalone display mode',async()=>{vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));await mount();expect(host.textContent).toBe('');});
 it('hides the entry in an iOS home-screen app',async()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});try{await mount();expect(host.textContent).toBe('');}finally{delete (navigator as Navigator&{standalone?:boolean}).standalone;}});
});
