import {test,expect} from './session-fixture';

for(const width of [390,1280]){
 test(`member ${width}px can open notices and acknowledge only their own account`,async({page,db,member,signInAs,baseURL},info)=>{
  await page.setViewportSize({width,height:900});
  const notice=await db.announcement.create({data:{titleZh:`合成公告-${width}`,bodyZh:'普通用户公告内容，仅合成测试。',status:'published',readPolicy:'keep'}});
  const hidden=await db.announcement.create({data:{titleZh:`隐藏合成公告-${width}`,bodyZh:'不得展示',status:'hidden'}});
  try{
   await signInAs(member.id);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   const loaded=page.waitForResponse(r=>r.url().includes('/api/announcements?')&&r.request().method()==='GET');
   await page.goto('/announcements');expect((await loaded).status()).toBe(200);
   await expect(page.getByRole('heading',{name:'公告中心',exact:true})).toBeVisible();
   const card=page.locator('article').filter({hasText:notice.titleZh});
   await expect(card).toBeVisible();await expect(page.getByText(hidden.titleZh,{exact:true})).toHaveCount(0);
   await expect(page.locator('main [role="alert"]')).toHaveCount(0);
   expect(await db.announcementRead.count({where:{announcementId:notice.id}})).toBe(0);
   const saved=page.waitForResponse(r=>r.url().includes(`/api/announcements/${notice.id}/read`));
   await card.getByRole('button',{name:'确认已阅',exact:true}).click();expect((await saved).status()).toBe(200);
   await expect(card).toHaveCount(0);await page.getByRole('button',{name:'历史公告',exact:true}).click();
   await expect(card).toBeVisible();await expect(card.getByText('已阅',{exact:true})).toBeVisible();
   expect(await db.announcementRead.count({where:{announcementId:notice.id,userId:member.id}})).toBe(1);
   expect((await page.request.get(baseURL+'/api/admin/announcements')).status()).toBe(403);
   await page.screenshot({path:info.outputPath(`notice-center-${width}.png`)});expect(errors).toEqual([]);
  }finally{await db.announcement.deleteMany({where:{id:{in:[notice.id,hidden.id]}}});}
 });

 test(`member ${width}px sees actionable load and save failures without losing the notice`,async({page,db,member,signInAs},info)=>{
  await page.setViewportSize({width,height:900});await signInAs(member.id);
  const notice=await db.announcement.create({data:{titleZh:`合成错误测试-${width}`,bodyZh:'已阅失败时应保留此公告。',status:'published',readPolicy:'hide'}});
  try{
   await page.route('**/api/announcements?*',r=>r.fulfill({status:401,contentType:'application/json',body:'{"message":"synthetic-private-server-detail"}'}));
   await page.goto('/announcements');const alert=page.locator('main [role="alert"]');
   await expect(alert).toContainText('重新登录');await expect(alert).toContainText('HTTP 401');
   await expect(page.locator('main')).not.toContainText('synthetic-private-server-detail');
   await page.unroute('**/api/announcements?*');await page.getByRole('button',{name:'刷新',exact:true}).click();
   const card=page.locator('article').filter({hasText:notice.titleZh});await expect(card).toBeVisible();await expect(alert).toHaveCount(0);
   await page.route(`**/api/announcements/${notice.id}/read`,r=>r.fulfill({status:403,contentType:'application/json',body:'{"message":"Cross-origin request denied"}'}));
   await card.getByRole('button',{name:'已阅，对我隐藏',exact:true}).click();
   await expect(alert).toContainText('保存已阅状态');await expect(alert).toContainText('正式地址');await expect(alert).toContainText('HTTP 403');
   await expect(card).toBeVisible();expect(await db.announcementRead.count({where:{announcementId:notice.id}})).toBe(0);
   await page.screenshot({path:info.outputPath(`notice-error-${width}.png`)});
   await page.unroute(`**/api/announcements/${notice.id}/read`);await card.getByRole('button',{name:'已阅，对我隐藏',exact:true}).click();
   await expect(card).toHaveCount(0);await expect(alert).toHaveCount(0);
  }finally{await db.announcement.delete({where:{id:notice.id}});}
 });
}

test('member can load the notice center without AbortSignal.any',async({page,member,signInAs})=>{
 await page.addInitScript(()=>{Object.defineProperty(AbortSignal,'any',{value:undefined,configurable:true});});
 await signInAs(member.id);const loaded=page.waitForResponse(r=>r.url().includes('/api/announcements?'));
 await page.goto('/announcements');expect((await loaded).status()).toBe(200);
 await expect(page.getByText(/第1页 · 共\d+条/)).toBeVisible();
 await expect(page.locator('main [role="alert"]')).toHaveCount(0);
});
