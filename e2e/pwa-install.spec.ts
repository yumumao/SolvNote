import {test,expect} from './session-fixture';

for(const device of [{name:'android',width:390,height:844},{name:'iphone',width:393,height:852}]){
 test(`${device.name}: public install metadata, native installability and unchanged login boundary`,async({browser,baseURL,member,signInAs},info)=>{
  // A regular test context is incognito, where Chrome intentionally forbids
  // installation. Use a fresh temporary profile, never the user's browser data.
  // An empty directory argument is owned/cleaned by Playwright under TEMP (F: locally).
  const channel=['chrome','msedge'].includes(process.env.SOLVNOTE_E2E_BROWSER_CHANNEL||'')?process.env.SOLVNOTE_E2E_BROWSER_CHANNEL:'chromium';
  const context=await browser.browserType().launchPersistentContext('',{channel,headless:true,baseURL,viewport:{width:device.width,height:device.height},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  try{
   const errors:string[]=[],writes:string[]=[];
   context.on('request',req=>{if(req.method()!=='GET'&&req.method()!=='HEAD'&&new URL(req.url()).pathname.startsWith('/api/'))writes.push(new URL(req.url()).pathname);});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const manifestResponse=await context.request.get('/manifest.webmanifest',{maxRedirects:0});
   expect(manifestResponse.status()).toBe(200);expect(manifestResponse.headers()['content-type']).toContain('manifest+json');
   const manifest=await manifestResponse.json();expect(manifest).toMatchObject({id:'/',start_url:'/',scope:'/',display:'standalone',short_name:'解迹'});
   for(const icon of manifest.icons){
    const r=await context.request.get(icon.src,{maxRedirects:0});expect(r.status()).toBe(200);expect(r.headers()['content-type']).toContain(icon.type);
   }
   const protectedResponse=await context.request.get('/api/ai/jobs',{maxRedirects:0});expect(protectedResponse.status()).toBe(401);
   await page.goto('/');await expect(page).toHaveURL(/\/login\?/);
   expect(await page.locator('link[rel="manifest"]').count()).toBe(1);
   const apple=page.locator('link[rel="apple-touch-icon"]');await expect(apple).toHaveAttribute('href','/icons/apple-touch-icon.png');
   await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content','yes');
   await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content','解迹 · SolvNote');
   const cdp=await context.newCDPSession(page);
   await expect.poll(async()=>{
    const data=await cdp.send('Page.getAppManifest');return data.errors;
   }).toEqual([]);
   // Check the browser's actual manifest/installability audit. No synthetic
   // beforeinstallprompt event is used as evidence that installation works.
   await expect.poll(async()=>(await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
   const install=page.locator('[data-install-app]');await expect(install).toBeVisible();
   await install.locator('summary').click();await expect(install).toHaveAttribute('open','');
   await expect(install).toContainText('Safari');await expect(install).toContainText('Chrome');await expect(install).toContainText('仍需联网');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   await install.screenshot({path:info.outputPath(`${device.name}-install-help.png`)});
   expect(await page.evaluate(async()=>({workers:(await navigator.serviceWorker.getRegistrations()).length,caches:await caches.keys()}))).toEqual({workers:0,caches:[]});
   await signInAs(member.id,context);await page.goto('/');await expect(page).toHaveURL(baseURL!+'/');
   await expect(page.locator('footer [data-install-app]')).toBeVisible();
   expect((await context.request.get('/api/ai/jobs')).status()).toBe(200);
   // The optional UI never submits jobs, changes user settings or registers SWs.
   expect(writes).toEqual([]);expect(errors).toEqual([]);
   await cdp.detach();
  }finally{await context.close();}
 });
}
