import { randomUUID } from 'node:crypto';
import { test, expect } from './session-fixture';

test('Admin defaults and existing users have separate orders; members mix built-in and personal AI safely', async ({page,context,browser,member,signInAs,baseURL,db})=>{
    test.setTimeout(120000);
    const external:string[]=[];
    await context.route('**/*',route=>{
        if(new URL(route.request().url()).origin!==baseURL){external.push('blocked');return route.abort();}
        return route.continue();
    });
    const admin=await browser.newContext({baseURL});
    try {
        await signInAs(undefined,admin);
        const current=await (await admin.request.get('/api/ai/config')).json();
        const prefix=randomUUID(),ids=[1,2,3].map(n=>`${prefix}-${n}`);
        const provider={id:prefix,name:'Order site',protocol:'chat',baseUrl:'https://example.com/v1',apiKey:'synthetic-order-site-only',enabled:true};
        const models=ids.map((id,i)=>({id,providerId:prefix,name:`Order built-in ${i+1}`,model:`order-${i+1}`,capabilities:i<2?['text','vision']:['text'],enabled:true}));
        const updated={...current.config,providers:[...current.config.providers,provider],models:[...current.config.models,...models]};
        expect((await admin.request.post('/api/ai/config',{headers:{Origin:baseURL!},data:{revision:current.revision,config:updated}})).status()).toBe(200);
        const policy=await (await admin.request.get('/api/admin/ai/access')).json();
        expect((await admin.request.patch('/api/admin/ai/access',{headers:{Origin:baseURL!},data:{revision:policy.revision,allowedModelIds:policy.models.map((m:{id:string})=>m.id),defaultModelIds:ids,defaultChains:{text:ids,vision:ids.slice(0,2)}}})).status()).toBe(200);

        // Real admin UI changes the two default lists independently.
        const adminPage=await admin.newPage();await adminPage.goto('/admin/ai');
        await adminPage.getByText('站点模型授权与新用户默认AI',{exact:true}).click();
        await adminPage.getByRole('region',{name:'新用户默认·解题顺序',exact:true}).getByRole('button',{name:'解题顺序：上移Order built-in 3',exact:true}).click();
        await adminPage.getByRole('region',{name:'新用户默认·读图顺序',exact:true}).getByRole('button',{name:'读图顺序：上移Order built-in 2',exact:true}).click();
        const savingDefaults=adminPage.waitForResponse(r=>r.url().endsWith('/api/admin/ai/access')&&r.request().method()==='PATCH');
        await adminPage.getByRole('button',{name:'保存站点权限',exact:true}).click();expect((await savingDefaults).status()).toBe(200);
        const defaults=await (await admin.request.get('/api/admin/ai/access')).json();
        expect(defaults.defaultChains).toEqual({text:[ids[0],ids[2],ids[1]],vision:[ids[1],ids[0]]});
        // Real account-creation transaction snapshots the same defaults as self-registration.
        const created=await admin.request.post('/api/admin/users',{headers:{Origin:baseURL!},data:{email:`order-${randomUUID()}@example.invalid`,name:'Order new account',role:'user',expirationDays:null}});
        expect(created.status()).toBe(201);
        const createdId=(await created.json()).user.id;
        const newAccount=await db.user.findUniqueOrThrow({where:{id:createdId},select:{aiModelOrder:true}});
        const snapshot=JSON.parse(newAccount.aiModelOrder!);
        expect(snapshot.text).toEqual(defaults.defaultChains.text);
        expect(snapshot.vision.filter((id:string)=>ids.slice(0,2).includes(id))).toEqual(defaults.defaultChains.vision);

        // Existing user is managed through the admin controls.
        await adminPage.getByLabel('用户ID',{exact:true}).fill(member.id);
        await adminPage.getByRole('button',{name:'加载用户授权',exact:true}).click();
        for(let i=1;i<=3;i++)await adminPage.getByLabel(`Order built-in ${i} · Order site`,{exact:true}).check();
        await adminPage.getByRole('region',{name:'此用户内置AI·解题顺序',exact:true}).getByRole('button',{name:'解题顺序：上移Order built-in 3',exact:true}).click();
        const savingUser=adminPage.waitForResponse(r=>r.url().includes('/api/admin/ai/access/users/')&&r.request().method()==='PATCH');
        await adminPage.getByRole('button',{name:'保存用户授权',exact:true}).click();expect((await savingUser).status()).toBe(200);

        await signInAs(member.id);await page.goto('/ai-settings');
        const text=page.getByRole('region',{name:'我的AI·解题顺序',exact:true});
        const vision=page.getByRole('region',{name:'我的AI·读图顺序',exact:true});
        await expect(text.getByRole('listitem')).toHaveCount(3);
        await expect(vision.getByRole('listitem')).toHaveCount(2);
        await text.getByRole('button',{name:'解题顺序：上移Order built-in 3',exact:true}).click();
        await vision.getByRole('button',{name:'读图顺序：上移Order built-in 2',exact:true}).click();
        let saving=page.waitForResponse(r=>r.url().endsWith('/api/user/ai-config/order')&&r.request().method()==='PATCH');
        await page.getByRole('button',{name:'保存调用顺序',exact:true}).click();expect((await saving).status()).toBe(200);
        await page.reload();await expect(text.getByRole('listitem').first()).toContainText('Order built-in 3');
        await expect(vision.getByRole('listitem').first()).toContainText('Order built-in 2');

        const personal={version:1,providers:[{...provider,id:'own',name:'Order personal',apiKey:'synthetic-personal-only'}],models:[{id:'own',providerId:'own',name:'Order personal model',model:'personal',capabilities:['text','vision'],enabled:true}],chains:{text:['own'],vision:['own']}};
        expect((await page.request.put('/api/user/ai-config',{headers:{Origin:baseURL!},data:{revision:0,config:personal}})).status()).toBe(200);
        await page.reload();await expect(page.getByText('文字 ✓（默认）',{exact:true})).toBeVisible();
        await text.getByRole('button',{name:'解题顺序：上移Order personal model',exact:true}).click();
        await vision.getByRole('button',{name:'读图顺序：上移Order personal model',exact:true}).click();
        saving=page.waitForResponse(r=>r.url().endsWith('/api/user/ai-config/order')&&r.request().method()==='PATCH');
        await page.getByRole('button',{name:'保存调用顺序',exact:true}).click();expect((await saving).status()).toBe(200);
        await page.reload();await expect(text.getByRole('listitem').nth(2)).toContainText('Order personal model');
        await expect(vision.getByRole('listitem').nth(1)).toContainText('Order personal model');
        const safe=await (await page.request.get('/api/user/ai-config/models')).json();
        expect(JSON.stringify(safe)).not.toMatch(/apiKey|baseUrl|synthetic-order-site-only|synthetic-personal-only/);
        expect((await page.request.get('/api/ai/config')).status()).toBe(403);
        expect((await page.request.patch('/api/user/ai-config/order',{headers:{Origin:baseURL!},data:{revisions:safe.revisions,chains:safe.chains,baseUrl:'https://evil.example'}})).status()).toBe(400);
        expect(external).toEqual([]);
    } finally {await admin.close();}
});
