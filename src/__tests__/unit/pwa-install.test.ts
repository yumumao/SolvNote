// @vitest-environment node
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('next-auth/jwt',()=>({getToken:vi.fn()}));
vi.mock('@/lib/user-management/live-session',()=>({getLiveUser:vi.fn(),isSessionCurrent:vi.fn()}));
vi.mock('@/lib/logger',()=>({createLogger:()=>({error:vi.fn()})}));
import {getToken} from 'next-auth/jwt';
import {getLiveUser} from '@/lib/user-management/live-session';
import {middleware} from '@/middleware';
import manifest from '@/app/manifest';

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXTAUTH_URL','https://app.example');});
afterEach(()=>vi.unstubAllEnvs());
describe('install metadata is public while application data stays authenticated',()=>{
 it.each(['GET','HEAD'])('serves the manifest anonymously without touching sessions or the DB (%s)',async method=>{
  vi.mocked(getToken).mockRejectedValue(new Error('Synthetic auth outage'));
  const res=await middleware(new NextRequest('https://app.example/manifest.webmanifest',{method}));
  expect(res?.status).toBe(200);expect(res?.headers.get('location')).toBeNull();
  expect(getToken).not.toHaveBeenCalled();expect(getLiveUser).not.toHaveBeenCalled();
 });
 it.each(['/','/ai-dialogue/private','/manifest.webmanifest/private'])('retains the login boundary for %s',async url=>{
  vi.mocked(getToken).mockResolvedValue(null);
  const res=await middleware(new NextRequest('https://app.example'+url));
  expect(res?.status).toBe(307);expect(res?.headers.get('location')).toContain('/login');
 });
 it('retains protected API and non-read authentication',async()=>{
  vi.mocked(getToken).mockResolvedValue(null);
  expect((await middleware(new NextRequest('https://app.example/api/ai/jobs')))?.status).toBe(401);
  expect((await middleware(new NextRequest('https://app.example/manifest.webmanifest',{method:'POST'})))?.status).toBe(307);
 });
 it('uses a stable same-origin identity and an authenticated normal launch route',()=>{
  expect(manifest()).toMatchObject({id:'/',scope:'/',start_url:'/',display:'standalone',short_name:'解迹'});
 });
 it.each([192,512])('includes a real square %ipx PNG for installation',size=>{
  const icon=manifest().icons?.find(i=>i.type==='image/png'&&i.sizes===`${size}x${size}`&&i.purpose!=='maskable');
  expect(icon).toBeDefined();
  const data=readFileSync(path.join(process.cwd(),'public',icon!.src));
  expect(data.subarray(1,4).toString()).toBe('PNG');expect(data.readUInt32BE(16)).toBe(size);expect(data.readUInt32BE(20)).toBe(size);
 });
 it('includes a separate maskable icon and an opaque 180px Apple touch icon',()=>{
  const icon=manifest().icons?.find(i=>i.purpose==='maskable');expect(icon?.sizes).toBe('512x512');
  for(const [src,size] of [[icon!.src,512],['/icons/apple-touch-icon.png',180]] as const){
   const data=readFileSync(path.join(process.cwd(),'public',src));expect(data.readUInt32BE(16)).toBe(size);expect(data.readUInt32BE(20)).toBe(size);
  }
 });
});
