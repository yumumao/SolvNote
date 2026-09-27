import {test,expect} from './session-fixture';
import sharp from 'sharp';
import {ParsedQuestionSchema} from '../src/lib/ai/schema';
import {JobInputSchema} from '../src/lib/ai-jobs/schema';
import type {DialogueView} from '../src/lib/ai-dialogue/types';

test('Evidence opens by default, a supplement preserves the original question, and step headings are bold',async({page,baseURL,member,signInAs})=>{
    const externalRequests:string[]=[];
    await page.route('**/*',route=>{
        if(new URL(route.request().url()).origin!==new URL(baseURL!).origin){externalRequests.push('blocked');return route.abort();}
        return route.continue();
    });
    const pixels=await sharp({create:{width:240,height:160,channels:3,background:'white'}}).png().toBuffer();
    const image='data:image/png;base64,'+pixels.toString('base64');
    const result=ParsedQuestionSchema.parse({questionText:'合成三角形题设，保留全部原条件与补充说明。',answerText:'合成答案',analysis:'### 分步解答\n\n#### 第一步：核对条件\n\n使用对应关系。\n\n#### 第二步：作辅助线\n\n给出严格证明。',subject:'数学',knowledgePoints:[],requiresImage:true});
    const view:DialogueView={id:'synthetic-evidence',state:'awaiting_user',revision:2,roundsUsed:0,roundLimit:10,roundOpen:true,roundAttempts:2,attemptLimit:6,roundElapsedMs:0,timeLimitMs:600000,isAdmin:false,activeJobId:null,
        input:JobInputSchema.parse({questionText:'合成三角形题设',imageBase64:image,originalImageBase64:image,mode:'transcribe',language:'zh',review:false,tags:[]}),
        transcript:{text:'合成原题转录：保留这段文字。',facts:[],uncertainties:['射线待核对'],missingInformation:[],geometry:{regions:[],angles:[{label:'1',vertex:'Q',arms:['P','R']}]}},
        messages:[],questions:['请核对射线'],steps:[],updatedAt:new Date().toISOString()};
    let posted=0;
    await page.route('**/api/ai/conversations/synthetic-evidence*',async route=>{
        if(route.request().method()==='POST'){
            const action=route.request().postDataJSON();expect(action).toMatchObject({kind:'continue',revision:2,text:'角1的另一条边为QS，其余题设不变。'});
            expect(action).not.toHaveProperty('correctedTranscript');posted++;
            view.transcriptClarifications=[action.text];view.state='answered';view.revision++;view.roundsUsed=1;view.roundOpen=false;view.questions=[];view.result=result;
            view.messages=[{id:'answer',kind:'answer',text:JSON.stringify(result),round:1,at:new Date().toISOString()}];
            return route.fulfill({json:{ok:true}});
        }
        return route.fulfill({json:view});
    });
    await signInAs(member.id);await page.goto('/ai-dialogue/synthetic-evidence');
    const imagePanel=page.locator('details').filter({has:page.getByText('原图对照',{exact:true})});
    const transcriptPanel=page.locator('details').filter({has:page.getByText('完整识图转录',{exact:true})});
    await expect(imagePanel).toHaveAttribute('open','');await expect(transcriptPanel).toHaveAttribute('open','');
    await imagePanel.locator('summary').click();await expect(imagePanel).not.toHaveAttribute('open','');
    await transcriptPanel.locator('summary').click();await expect(transcriptPanel).not.toHaveAttribute('open','');
    await imagePanel.locator('summary').click();await transcriptPanel.locator('summary').click();
    await expect(page.getByText('合成原题转录：保留这段文字。',{exact:true})).toBeVisible();
    await page.getByLabel('补充条件/纠正转录',{exact:true}).fill('角1的另一条边为QS，其余题设不变。');
    await page.getByRole('button',{name:'继续当前轮',exact:true}).click();
    await expect(page.getByRole('heading',{name:'已采用的补充说明'})).toBeVisible();expect(posted).toBe(1);
    for(const name of ['分步解答','第一步：核对条件','第二步：作辅助线']){
        const heading=page.getByRole('heading',{name,exact:true}).first();await expect(heading).toBeVisible();await expect(heading).toHaveCSS('font-weight','700');
    }
    await expect(page.getByText('合成原题转录：保留这段文字。',{exact:true})).toBeVisible();expect(externalRequests).toEqual([]);
});
