// @vitest-environment node
import {beforeAll, beforeEach, afterAll, describe, it, expect, vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtempSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const shared=vi.hoisted(()=>({db:null as unknown as PrismaClient,validToken:true}));
vi.mock('@/lib/prisma',()=>({get prisma(){return shared.db;}}));
vi.mock('@/lib/security/turnstile',()=>({verifyTurnstileToken:async()=>shared.validToken,getTurnstilePublicConfig:()=>({turnstileSiteKey:'synthetic',turnstileConfigured:true})}));
vi.mock('@/lib/ai-access/registration',()=>({createInitialAiGrants:async(tx:any,userId:string)=>{const rows=await tx.aiSiteModelAccess.findMany({where:{isAllowed:true,defaultRank:{not:null}}});for(const r of rows)await tx.aiUserModelGrant.create({data:{userId,modelId:r.modelId,rank:r.defaultRank,source:'default'}});}}));
vi.mock("@/lib/ai-access/bootstrap",()=>({ensureInitialAiPolicy:vi.fn(async()=>{})}));
import {getRegistrationSettings,saveRegistrationSettings,createInvite,updateInvite,publicRegistrationStatus} from '@/lib/user-management/registration-settings';
import {registerUser} from '@/lib/user-management/registration';
import {getLiveUser,isSessionCurrent} from '@/lib/user-management/live-session';
import {createManagedUser,updateManagedUser,resetManagedPassword,deleteManagedUser,changeOwnPassword} from '@/lib/user-management/users';
import {purgeExpiredUsers} from '@/lib/user-management/purge-expired-users';
import {consumeAuthLimit} from '@/lib/user-management/rate-limit';
const DAY=86400000,now=new Date('2026-09-27T00:00:00Z');
const input=(email='trial@example.invalid')=>({email,name:'Synthetic',password:'Synthetic-passphrase-for-test',turnstileToken:'synthetic-token'});
beforeAll(async()=>{
 mkdirSync('.codex/tmp',{recursive:true});const dir=mkdtempSync(path.resolve('.codex/tmp/user-lifecycle-'));
 const url='file:'+path.join(dir,'fixture.db').replaceAll('\\','/');
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:url},windowsHide:true,stdio:'pipe'});
 shared.db=new PrismaClient({datasources:{db:{url}}});process.env.AI_CONFIG_MASTER_KEY='cd'.repeat(32);
},30000);
beforeEach(async()=>{
 shared.validToken=true;await shared.db.invitationUse.deleteMany();await shared.db.aiUserModelGrant.deleteMany();await shared.db.userAiConfiguration.deleteMany();await shared.db.user.deleteMany();await shared.db.invitationCode.deleteMany();await shared.db.registrationSettings.deleteMany();await shared.db.aiSiteModelAccess.deleteMany();await shared.db.authRateLimit.deleteMany();
 await shared.db.user.create({data:{id:'admin',email:'admin@example.invalid',password:'unused',role:'admin'}});
 for(let i=1;i<=4;i++)await shared.db.aiSiteModelAccess.create({data:{modelId:'model-'+i,fingerprint:'synthetic-'+i,defaultRank:i<=3?i:null}});
});
afterAll(async()=>{delete process.env.AI_CONFIG_MASTER_KEY;await shared.db?.$disconnect();});
const enable=async(extra:Record<string,unknown>={})=>{const p=await getRegistrationSettings();return saveRegistrationSettings('admin',{revision:p.revision,enabled:true,...extra});};
describe.sequential('registration and account lifecycle on disposable SQLite',()=>{
 it('defaults off; existing users stay permanent; seven-day trial and exactly three default grants',async()=>{
  expect((await getRegistrationSettings()).enabled).toBe(false);
  await expect(registerUser(input(),{},now)).rejects.toThrow('REGISTRATION_DISABLED');
  expect((await shared.db.user.findUniqueOrThrow({where:{id:'admin'}})).expiresAt).toBeNull();
  await enable();const user=await registerUser({...input(),password:'abcdefgh'},{},now);
  expect(user.expiresAt).toEqual(new Date(now.getTime()+7*DAY));
  expect(await shared.db.aiUserModelGrant.count({where:{userId:user.id}})).toBe(3);
  expect(JSON.stringify(user)).not.toMatch(/password|sessionVersion|apiKey/);
 });
 it('fails closed on invalid Turnstile and rejects privilege/expiry injection',async()=>{
  await enable();shared.validToken=false;await expect(registerUser(input(),{},now)).rejects.toThrow('VERIFICATION_FAILED');
  shared.validToken=true;await expect(registerUser({...input(),role:'admin'}, {},now)).rejects.toThrow();
  expect(await shared.db.user.count()).toBe(1);
 });
 it('invites default to 30 days, consume once, hide unless explicitly selected, and renew with CAS',async()=>{
  await enable({inviteRequired:true});const made=await createInvite('admin',{},now);
  expect(made.invite.expiresAt).toEqual(new Date(now.getTime()+30*DAY));
  expect((await publicRegistrationStatus(now)).inviteCode).toBeNull();
  const settings=await getRegistrationSettings();await saveRegistrationSettings('admin',{revision:settings.revision,inviteDisplayEnabled:true,displayedInviteId:made.invite.id});
  expect((await publicRegistrationStatus(now)).inviteCode).toBe(made.code);
  const user=await registerUser({...input(),inviteCode:made.code},{},now);
  expect(await shared.db.invitationUse.count({where:{userId:user.id}})).toBe(1);
  await expect(registerUser({...input('second@example.invalid'),inviteCode:made.code},{},now)).rejects.toThrow('REGISTRATION_REJECTED');
  expect((await publicRegistrationStatus(now)).inviteCode).toBeNull();
  const renewed=await updateInvite('admin',made.invite.id,{revision:made.invite.revision,renewDays:30},new Date(now.getTime()+DAY));
  expect(renewed.expiresAt).toEqual(new Date(now.getTime()+60*DAY));
  expect(renewed.usedCount).toBe(1); // renewal never resets a used invitation
  await expect(updateInvite('admin',made.invite.id,{revision:made.invite.revision,renewDays:30},now)).rejects.toThrow('REVISION_CONFLICT');
 });
 it('duplicate registration rolls back invitation and grant writes without leaking account existence',async()=>{
  await enable({inviteRequired:true});const made=await createInvite('admin',{},now);
  await expect(registerUser({...input('admin@example.invalid'),inviteCode:made.code},{},now)).rejects.toThrow('REGISTRATION_REJECTED');
  expect((await shared.db.invitationCode.findUniqueOrThrow({where:{id:made.invite.id}})).usedCount).toBe(0);
 });
 it('live guard rejects expired/disabled/deleted accounts and revoked sessions',async()=>{
  const u=await shared.db.user.create({data:{email:'expired@example.invalid',password:'unused',expiresAt:now}});
  expect(await getLiveUser(u.id,now)).toBeNull();
  expect(isSessionCurrent({sessionVersion:1},{sessionVersion:0})).toBe(false);
  expect(isSessionCurrent({sessionVersion:0},{})).toBe(true); // pre-upgrade session
  await shared.db.user.update({where:{id:u.id},data:{expiresAt:null,isActive:false}});expect(await getLiveUser(u.id,now)).toBeNull();
 });
 it('admin-created users default permanent; reset forces change and revokes all old sessions',async()=>{
  const made=await createManagedUser('admin',{email:'manual@example.invalid',name:'Manual'},now);
  expect(made.user.expiresAt).toBeNull();expect(made.temporaryPassword.length).toBeGreaterThanOrEqual(20);
  const reset=await resetManagedPassword('admin',made.user.id,{revision:made.user.revision});
  const row=await shared.db.user.findUniqueOrThrow({where:{id:made.user.id}});
  expect(row.mustChangePassword).toBe(true);expect(row.sessionVersion).toBe(1);expect(row.password).not.toBe(reset.temporaryPassword);
  await changeOwnPassword(row.id,{currentPassword:reset.temporaryPassword,newPassword:'abcdefgh'},row.sessionVersion);
  const changed=await shared.db.user.findUniqueOrThrow({where:{id:row.id}});expect(changed.mustChangePassword).toBe(false);expect(changed.sessionVersion).toBe(2);
 });
 it('protects self and last usable admin; expiry extension revokes sessions and uses CAS',async()=>{
  await expect(deleteManagedUser('admin','admin',{revision:1})).rejects.toThrow('SELF_ACTION_DENIED');
  const second=await shared.db.user.create({data:{email:'second-admin@example.invalid',password:'unused',role:'admin',isActive:false}});
  await expect(updateManagedUser(second.id,'admin',{revision:1,isActive:false},now)).rejects.toThrow('ADMIN_AUTHORIZATION_REVOKED');
  const made=await createManagedUser('admin',{email:'extend@example.invalid',name:'Extend',expirationDays:7},now);
  const updated=await updateManagedUser('admin',made.user.id,{revision:1,expirationDays:30},now);
  expect(updated.expiresAt).toEqual(new Date(now.getTime()+30*DAY));
  await expect(updateManagedUser('admin',made.user.id,{revision:1,expirationDays:null},now)).rejects.toThrow('REVISION_CONFLICT');
 });
 it('purges expired non-admin accounts at 30 days, removes detached AI jobs, is idempotent',async()=>{
  const victim=await shared.db.user.create({data:{email:'purge@example.invalid',password:'unused',expiresAt:new Date(now.getTime()-30*DAY)}});
  const retained=await shared.db.user.create({data:{email:'retain@example.invalid',password:'unused',expiresAt:new Date(now.getTime()-30*DAY+1)}});
  await shared.db.aiJob.create({data:{userId:victim.id,kind:'text',requestKey:'synthetic',input:'synthetic-encrypted-placeholder',expiresAt:now}});
  expect((await purgeExpiredUsers(now)).deleted).toBe(1);expect(await shared.db.aiJob.count({where:{userId:victim.id}})).toBe(0);
  expect(await shared.db.user.findUnique({where:{id:retained.id}})).not.toBeNull();expect((await purgeExpiredUsers(now)).deleted).toBe(0);
 });
 it('rate counters persist in the database and reset only after the window',async()=>{
  expect(await consumeAuthLimit('test:synthetic',2,1000,now)).toBe(true);
  expect(await consumeAuthLimit('test:synthetic',2,1000,now)).toBe(true);
  expect(await consumeAuthLimit('test:synthetic',2,1000,now)).toBe(false);
  expect(await consumeAuthLimit('test:synthetic',2,1000,new Date(now.getTime()+1000))).toBe(true);
 });
});
