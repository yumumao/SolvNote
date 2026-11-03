import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),assertSameOrigin:vi.fn(),info:vi.fn(),error:vi.fn(),warn:vi.fn()}));
vi.mock('@/lib/ai-access',()=>({requireUser:mocks.requireUser,assertSameOrigin:mocks.assertSameOrigin,aiErrorResponse:()=>new Response(null,{status:403})}));
vi.mock('@/lib/logger',()=>({createLogger:()=>({info:mocks.info,error:mocks.error,warn:mocks.warn})}));
import {POST} from '@/app/api/logs/frontend/route';
beforeEach(()=>{vi.clearAllMocks();mocks.requireUser.mockResolvedValue({id:'synthetic-user',role:'user'});});
describe('retired browser log collector',()=>{
 it('never reads or records browser payloads from older clients',async()=>{
  const request=new NextRequest('https://example.invalid/api/logs/frontend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({logs:[{level:'info',message:'PRIVATE_MESSAGE',context:{password:'PRIVATE_PASSWORD'},url:'https://example.invalid/?invite=PRIVATE_INVITE'}]})});
  const read=vi.spyOn(request,'json');
  const result=await POST(request);
  expect(result.status).toBe(204);expect(read).not.toHaveBeenCalled();expect(mocks.requireUser).toHaveBeenCalled();expect(mocks.assertSameOrigin).toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();expect(mocks.warn).not.toHaveBeenCalled();expect(mocks.error).not.toHaveBeenCalled();
 });
 it('rejects a revoked session even on direct route access',async()=>{
  mocks.requireUser.mockRejectedValue(new Error('private auth failure'));
  const result=await POST(new NextRequest('https://example.invalid/api/logs/frontend',{method:'POST',body:'{}'}));
  expect(result.status).toBe(403);expect(mocks.info).not.toHaveBeenCalled();
 });
});
