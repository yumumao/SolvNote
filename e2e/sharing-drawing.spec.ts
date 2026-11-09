import {test,expect} from './session-fixture';
import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
import {ParsedQuestionSchema} from '../src/lib/ai/schema';
import {JobInputSchema} from '../src/lib/ai-jobs/schema';
import type {DialogueView} from '../src/lib/ai-dialogue/types';
import {preserveDrawingEvidence} from '../src/lib/ai-drawing/evidence-server';
import {ConstructionSchema} from '../src/lib/ai-drawing/construction';

for(const device of [{name:'desktop',width:1280,height:900,dpr:1},{name:'phone',width:390,height:844,dpr:3}]){
 test(`${device.name}: failed correction stays shareable with shading, labels and device-sized single PNG`,async({browser,baseURL,member,signInAs},info)=>{
  const context=await browser.newContext({baseURL,viewport:{width:device.width,height:device.height},deviceScaleFactor:device.dpr,serviceWorkers:'block'});
  try{
   const blocked:string[]=[],errors:string[]=[];let drawingCalls=0;
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==baseURL){blocked.push('external');return route.abort();}return route.continue();});
   const pixels=await sharp({create:{width:80,height:60,channels:3,background:'white'}}).png().toBuffer(),image='data:image/png;base64,'+pixels.toString('base64');
   const plan={title:'合成阴影扇形',points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}],segments:[['O','A'],['O','B']],arcs:[{center:'O',start:'A',end:'B',direction:'ccw'}],regions:[{contours:[{start:'O',edges:[{kind:'segment',to:'A'},{kind:'arc',center:'O',to:'B',direction:'ccw'},{kind:'segment',to:'O'}]}]}],annotations:[{kind:'text',x:1.3,y:1.3,text:'阴影甲：12cm²'}],steps:[]};
   plan.annotations.push({kind:'text',x:60,y:40,text:'远处说明：甲表示阴影区域，单位为平方厘米'});
   const analysis=Array.from({length:16},(_,i)=>`### 第${i+1}步\n\n先核对题目条件，再分割拼补并比较面积。$12+8=20$。${i===0?'\n\n$$1+2+3+4+5+6+7+8+9+10+11+12=78$$':''}`).join('\n\n');
   const result=ParsedQuestionSchema.parse({questionText:'合成扇形题目',answerText:'合成答案',analysis,subject:'数学',knowledgePoints:[],requiresImage:true});
   const sourceCaption='图1：甲表示种植区域，乙表示道路。图注原文须完整保留，面积单位是平方厘米。';
   const view:DialogueView={id:'synthetic-share',state:'answered',revision:2,roundsUsed:1,roundLimit:10,roundOpen:false,roundAttempts:1,attemptLimit:6,roundElapsedMs:0,timeLimitMs:600000,isAdmin:false,activeJobId:null,input:JobInputSchema.parse({questionText:result.questionText,imageBase64:image,originalImageBase64:image}),messages:[],questions:[],steps:[],result,updatedAt:new Date().toISOString()};
   view.transcript={text:result.questionText,facts:[{detail:sourceCaption,source:'image'}],uncertainties:[],missingInformation:[]};
   await context.route('**/api/ai/conversations/synthetic-share*',r=>r.fulfill({json:view}));
   await context.route('**/api/notebooks',r=>r.fulfill({json:[]}));
   await context.route('**/api/ai/drawing/construction',r=>{
    drawingCalls++;if(drawingCalls!==1)return r.fulfill({status:502,json:{message:'AI_DRAWING_UNSUPPORTED'}});
    const input=JobInputSchema.parse(r.request().postDataJSON());expect(input.drawingEvidence?.imageFacts).toEqual([sourceCaption]);
    return r.fulfill({json:{type:'construction',plan:preserveDrawingEvidence(ConstructionSchema.parse(plan),input.drawingEvidence)}});
   });
   await signInAs(member.id,context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.goto('/ai-dialogue/synthetic-share');
   await page.getByRole('button',{name:'第一步：生成原题底图',exact:true}).click();
   await expect(page.locator('[data-base-region]')).toHaveCount(1);
   await page.locator('[data-drawing-correction]').fill('合成纠正：核对阴影甲的标注位置');
   await page.getByRole('button',{name:'根据纠正说明重新生成原题底图',exact:true}).click();
   await expect(page.getByRole('button',{name:'根据纠正说明重新生成原题底图',exact:true})).toBeEnabled();
   expect(drawingCalls).toBe(2);
   await page.getByRole('button',{name:'分享解题过程',exact:true}).click();
   const dialog=page.locator('dialog[data-solution-dialog]');
   await expect(dialog.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed',String(device.name==='phone'));
   await expect(dialog.locator('[data-solution-document]')).toHaveAttribute('data-fit-width',String(device.name==='phone'));
   await dialog.getByLabel('附带题干',{exact:true}).check();
   await expect(dialog.getByLabel('附带原题重绘（第一步）',{exact:true})).toBeChecked();
   await expect(dialog.locator('[data-base-review-note]')).toContainText('尚未按新纠正说明更新');
   await expect(dialog.locator('[data-diagram-annotation="text"]')).toContainText('阴影甲：12cm²');
   await expect(dialog.locator('[data-diagram-caption]')).toContainText('远处说明：甲表示阴影区域，单位为平方厘米');
   await expect(dialog.locator('[data-diagram-caption]')).toContainText(sourceCaption);
   const compactBox=await dialog.locator('svg').getAttribute('viewBox');expect(Number(compactBox!.split(' ')[2])).toBeLessThan(850);
   const width=await dialog.locator('[data-solution-document]').evaluate(e=>e.getBoundingClientRect().width);
   await dialog.getByRole('button',{name:'生成分享长图',exact:true}).click();
   await expect(dialog.locator('[data-solution-image-stack] img')).toHaveCount(1);
   const link=dialog.getByRole('link',{name:'下载第1张图片',exact:true});
   const downloading=page.waitForEvent('download');await link.click();const download=await downloading;
   const file=info.outputPath(`${device.name}-share.png`);await download.saveAs(file);
   const png=await sharp(file).metadata();expect(png.width).toBe(Math.round(width)*device.dpr);expect(png.height).toBeGreaterThan(1800);expect(png.width!*png.height!).toBeLessThanOrEqual(16*1024*1024);
   await expect(dialog.locator('[data-solution-watermark]')).toContainText('solvnote.n29.net');
   const previewFile=info.outputPath(`${device.name}-diagram-preview.png`);
   // Compare an exported geometry patch with an actual DOM screenshot: fill and text
   // must survive foreignObject rendering, not just exist in the source markup.
   const diagram=dialog.locator('[data-solution-document] svg');const region=diagram.locator('[data-base-region]');
   await diagram.scrollIntoViewIfNeeded();await diagram.screenshot({path:previewFile});
   await page.screenshot({path:info.outputPath(`${device.name}-preview.png`)});
   const rect=await region.boundingBox();expect(rect?.width).toBeGreaterThan(20);
   const doc=await dialog.locator('[data-solution-document]').boundingBox();
   const sample={left:Math.round((rect!.x-doc!.x+rect!.width*.15)*device.dpr),top:Math.round((rect!.y-doc!.y+rect!.height*.85)*device.dpr),width:3,height:3};
   const exported=await sharp(file).extract(sample).removeAlpha().raw().toBuffer();
   const svgRect=await diagram.boundingBox();
   const displayed=await sharp(previewFile).extract({...sample,left:Math.round((rect!.x-svgRect!.x+rect!.width*.15)*device.dpr),top:Math.round((rect!.y-svgRect!.y+rect!.height*.85)*device.dpr)}).removeAlpha().raw().toBuffer();
   const mean=(b:Buffer)=>b.reduce((n,v)=>n+v,0)/b.length;
   expect(mean(exported)).toBeLessThan(245);expect(Math.abs(mean(exported)-mean(displayed))).toBeLessThan(12);
   // A scrollable wide table must remain complete in the exported raster.
   const cells=Array.from({length:18},(_,i)=>String(123456+i));
   view.result={...result,analysis:`|${cells.join('|')}|\n|${cells.map(()=>'---').join('|')}|\n|${cells.map(()=>'987654').join('|')}|`};
   await page.reload();await page.getByRole('button',{name:'分享解题过程',exact:true}).click();
   const tableWidth=await dialog.locator('[data-solution-document]').evaluate(el=>{
    const table=el.querySelector('table')!,last=table.querySelector('tbody tr td:last-child')!;
    const doc=el.getBoundingClientRect(),rect=table.getBoundingClientRect(),cell=last.getBoundingClientRect();
    return {required:table.scrollWidth+rect.left-doc.left+parseFloat(getComputedStyle(el).paddingRight),last:{left:cell.left-doc.left,top:cell.top-doc.top,width:cell.width,height:cell.height}};
   });
   await dialog.getByRole('button',{name:'生成分享长图',exact:true}).click();
   await expect(dialog.locator('[data-solution-image-stack] img')).toHaveCount(1);
   const wideDownload=page.waitForEvent('download');await dialog.getByRole('link',{name:'下载第1张图片',exact:true}).click();
   const tableFile=info.outputPath(`${device.name}-wide-table.png`);await (await wideDownload).saveAs(tableFile);
   const tablePng=await sharp(tableFile).metadata();expect(tablePng.width).toBeGreaterThanOrEqual(Math.ceil(tableWidth.required)*device.dpr);
   const lastPixels=await sharp(tableFile).extract({left:Math.ceil((tableWidth.last.left+4)*device.dpr),top:Math.ceil((tableWidth.last.top+4)*device.dpr),width:Math.floor((tableWidth.last.width-8)*device.dpr),height:Math.floor((tableWidth.last.height-8)*device.dpr)}).removeAlpha().raw().toBuffer();
   expect([...lastPixels].filter(v=>v<100).length).toBeGreaterThan(30);
   await writeFile(info.outputPath('result.json'),JSON.stringify({device,width,png:{width:png.width,height:png.height},tablePng:{width:tablePng.width,height:tablePng.height},drawingCalls,errors,blocked},null,2));
   expect(errors).toEqual([]);expect(blocked).toEqual([]);expect(drawingCalls).toBe(2);
  }finally{await context.close();}
 });
}
