import {test,expect} from './session-fixture';
import {ParsedQuestionSchema} from '../src/lib/ai/schema';
import {JobInputSchema} from '../src/lib/ai-jobs/schema';
import type {DialogueView} from '../src/lib/ai-dialogue/types';
import {ConstructionSchema} from '../src/lib/ai-drawing/construction';

for(const device of [{name:'desktop',width:1280,height:900},{name:'phone',width:390,height:844}]){
 test(`${device.name}: keeps waiting after a model refusal and shows categorized refusals in both the editor and task history`,async({browser,baseURL,member,signInAs},info)=>{
  const context=await browser.newContext({baseURL,viewport:{width:device.width,height:device.height},serviceWorkers:'block'});
  try{
   const errors:string[]=[],blocked:string[]=[];let calls=0,polls=0;
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==baseURL){blocked.push('external');return route.abort();}return route.continue();});
   const question='图外说明：连接已有点B和C。\n完整题文和图注仍保留。';
   const result=ParsedQuestionSchema.parse({questionText:question,answerText:'连接B和C',analysis:'连接已有两点，底图不变。',subject:'数学',knowledgePoints:[]});
   const base=ConstructionSchema.parse({title:'合成底图',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0},{id:'C',x:0,y:3}],segments:[['A','B'],['A','C']],sourceText:question,sourceCaptions:['图1：原图图注'],steps:[]});
   const auxiliary={...base,steps:[{description:'连接B和C',operation:{kind:'segment',a:'B',b:'C'}}]};
   const view:DialogueView={id:'synthetic-auxiliary-fallback',state:'answered',revision:2,roundsUsed:1,roundLimit:10,roundOpen:false,roundAttempts:1,attemptLimit:6,roundElapsedMs:5000,timeLimitMs:600000,isAdmin:false,activeJobId:null,input:JobInputSchema.parse({questionText:question}),messages:[],questions:[],result,updatedAt:new Date().toISOString(),steps:[]};
   await context.route('**/api/ai/conversations/synthetic-auxiliary-fallback*',r=>r.fulfill({json:view}));
   await context.route('**/api/notebooks',r=>r.fulfill({json:[]}));
   await context.route('**/api/ai/drawing/construction',r=>{
    calls++;if(calls===1)return r.fulfill({json:{type:'construction',plan:base}});
    expect(r.request().postDataJSON().drawingPlan).toEqual(base);
    return r.fulfill({status:202,json:{jobId:calls===2?'auxiliary-success':'auxiliary-refused'}});
   });
   const refusal={state:'failed',errorCode:'AI_DRAWING_UNSUPPORTED',modelName:'First model',diagnostic:'DRAWING_CIRCLE_INTERSECTION'};
   await context.route('**/api/ai/jobs/auxiliary-success',r=>{
    polls++;return r.fulfill({json:polls===1?{state:'running',attemptsLog:[refusal]}:{state:'success',result:{type:'construction',plan:auxiliary},attemptsLog:[refusal,{state:'success'}]}});
   });
   await context.route('**/api/ai/jobs/auxiliary-refused*',r=>r.fulfill({json:{id:'auxiliary-refused',kind:'construction',state:'failed',errorCode:'AI_BUDGET_EXHAUSTED',attemptsLog:[refusal,{...refusal,modelName:'Second model',diagnostic:'DRAWING_MISSING_BASE_POINT'}]}}));
   await context.route('**/api/ai/jobs',r=>r.fulfill({json:{jobs:[]}}));
   await context.route('**/api/ai/conversations',r=>r.fulfill({json:{conversations:[]}}));
   await signInAs(member.id,context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.goto('/ai-dialogue/synthetic-auxiliary-fallback');
   await page.getByRole('button',{name:'第一步：生成原题底图',exact:true}).click();await page.locator('[data-confirm-base]').check();
   const stage=page.locator('[data-drawing-stage="auxiliary"]');const button=stage.getByRole('button',{name:'第二步：在锁定底图上添加辅助线',exact:true});
   await expect(stage).toContainText('尝试下一候选');
   await button.click();await expect(stage.getByRole('progressbar')).toBeVisible();await expect(stage.getByRole('alert')).toHaveCount(0);
   await expect(stage.locator('[data-aux-segment]')).toBeVisible();await expect(stage.getByRole('progressbar')).toHaveCount(0);
   await expect(stage.locator('[data-diagram-source-text]')).toContainText('完整题文');expect(calls).toBe(2);
   await stage.screenshot({path:info.outputPath(`${device.name}-auxiliary-success.png`)});
   await button.click();await expect(stage.getByRole('alert')).toContainText('辅助线生成失败');await expect(stage.getByRole('alert')).toContainText('缺少解答引用的原有点');
   await expect(stage.getByRole('alert')).not.toContainText('未自动换模型重试');await expect(stage.locator('[data-aux-segment]')).toBeVisible();
   await expect(page.locator('[data-drawing-stage="base"] [data-diagram-source-text]')).toContainText('完整题文');
   await stage.screenshot({path:info.outputPath(`${device.name}-auxiliary-refused.png`)});
   await stage.getByRole('link',{name:'查看/取回本次作图任务',exact:true}).click();
   const details=page.getByRole('dialog');await expect(details.getByRole('alert')).toContainText('缺少解答引用的原有点');
   await expect(details.locator('[data-attempt-diagnostics]')).toContainText('圆与直线');
   await details.screenshot({path:info.outputPath(`${device.name}-task-reasons.png`)});
   expect(calls).toBe(3);expect(polls).toBe(2);expect(errors).toEqual([]);expect(blocked).toEqual([]);
  }finally{await context.close();}
 });
}
