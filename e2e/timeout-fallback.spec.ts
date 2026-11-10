import {test,expect} from './session-fixture';
import {ParsedQuestionSchema} from '../src/lib/ai/schema';
import {JobInputSchema} from '../src/lib/ai-jobs/schema';
import type {DialogueView} from '../src/lib/ai-dialogue/types';
import {ConstructionSchema} from '../src/lib/ai-drawing/construction';

for(const device of [{name:'desktop',width:1280,height:900},{name:'phone',width:390,height:844}]){
 test(`${device.name}: timeout switch stays visible and auxiliary errors retain the text-bearing base`,async({browser,baseURL,member,signInAs},info)=>{
  const context=await browser.newContext({baseURL,viewport:{width:device.width,height:device.height},serviceWorkers:'block'});
  try{
   const errors:string[]=[],blocked:string[]=[];let calls=0;
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==baseURL){blocked.push('external');return route.abort();}return route.continue();});
   const question='图外说明：请根据已知条件连接辅助线。\n完整题文保留在图下方。';
   const result=ParsedQuestionSchema.parse({questionText:question,answerText:'连接B和C',analysis:'连接已有两点，保持底图不变。',subject:'数学',knowledgePoints:[]});
   const base=ConstructionSchema.parse({title:'合成底图',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0},{id:'C',x:0,y:3}],segments:[['A','B'],['A','C']],sourceText:question,sourceCaptions:['图1：原图图注'],steps:[]});
   const auxiliary={...base,steps:[{description:'连接B和C',operation:{kind:'segment',a:'B',b:'C'}}]};
   const view:DialogueView={id:'synthetic-timeout',state:'answered',revision:2,roundsUsed:1,roundLimit:10,roundOpen:false,roundAttempts:3,attemptLimit:6,roundElapsedMs:185000,timeLimitMs:600000,isAdmin:false,activeJobId:null,input:JobInputSchema.parse({questionText:question}),messages:[],questions:[],result,updatedAt:new Date().toISOString(),steps:[
    {id:'first',modelId:'first',modelName:'首选模型',state:'unknown',stage:'recognize',diagnostic:'TIMEOUT_BEFORE_HEADERS',errorCode:'AI_ACCEPTANCE_UNKNOWN',startedAt:'2026-11-11T00:00:00Z',finishedAt:'2026-11-11T00:03:00Z'},
    {id:'next',modelId:'next',modelName:'下一模型',state:'success',stage:'recognize',timeoutFallback:true,startedAt:'2026-11-11T00:03:00Z',finishedAt:'2026-11-11T00:03:05Z'},
   ]};
   await context.route('**/api/ai/conversations/synthetic-timeout*',r=>r.fulfill({json:view}));
   await context.route('**/api/notebooks',r=>r.fulfill({json:[]}));
   await context.route('**/api/ai/drawing/construction',r=>{
    calls++;if(calls===2)return r.fulfill({status:400,json:{message:'INVALID_REQUEST_OR_CONFIGURATION'}});
    if(calls>1)expect(r.request().postDataJSON().drawingPlan).toEqual(base);
    return r.fulfill({json:{type:'construction',plan:calls===1?base:auxiliary}});
   });
   await signInAs(member.id,context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.goto('/ai-dialogue/synthetic-timeout');
   await expect(page.getByText('上一模型调用超时，已自动切换到当前模型；上一请求仍可能继续处理或计费。',{exact:true})).toBeVisible();
   await expect(page.getByText('到达调用时限前未收到响应头；服务端是否完成未知，未向本模型重发。',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'第一步：生成原题底图',exact:true}).click();
   await page.locator('[data-confirm-base]').check();
   const stage=page.locator('[data-drawing-stage="auxiliary"]');
   const button=stage.getByRole('button',{name:'第二步：在锁定底图上添加辅助线',exact:true});
   await button.click();await expect(stage.getByRole('alert')).toContainText('辅助线生成失败');
   await expect(stage.getByRole('alert')).toContainText('请求未被接受');
   await expect(page.locator('[data-drawing-stage="base"] [data-diagram-source-text]')).toContainText('完整题文保留');
   await stage.screenshot({path:info.outputPath(`${device.name}-auxiliary-error.png`)});
   expect(calls).toBe(2);
   await button.click();await expect(stage.locator('svg')).toBeVisible();await expect(stage.getByRole('alert')).toHaveCount(0);
   await expect(stage.locator('[data-diagram-source-text]')).toContainText('完整题文保留');
   await stage.screenshot({path:info.outputPath(`${device.name}-auxiliary-success.png`)});
   expect(calls).toBe(3);expect(errors).toEqual([]);expect(blocked).toEqual([]);
  }finally{await context.close();}
 });
}
