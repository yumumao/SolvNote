// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const s=vi.hoisted(()=>({findMany:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{aiJob:{findMany:s.findMany}}}));
vi.mock('@/lib/ai-access',()=>({requireUser:async()=>({id:'synthetic-owner'})}));
vi.mock('@/lib/ai-jobs/store',()=>({publicJob:(j:unknown)=>j}));
import {GET} from '@/app/api/ai/jobs/route';
import {safeError} from '@/lib/ai-http';
beforeEach(()=>{s.findMany.mockReset();s.findMany.mockResolvedValue([]);});
describe('task history read projections',()=>{
 it('selects metadata at the database instead of loading every encrypted image/result',async()=>{
  expect((await GET(new Request('https://example.invalid/api/ai/jobs'))).status).toBe(200);
  const query=s.findMany.mock.calls[0][0];expect(query.where.userId).toBe('synthetic-owner');
  expect(query.select).toEqual({id:true,kind:true,state:true,attempts:true,errorCode:true,createdAt:true,updatedAt:true});
 });
 it('preserves the fixed model-revocation code without exposing an arbitrary error',async()=>{
  expect(await safeError(Object.assign(Error('AI_MODEL_ACCESS_REVOKED'),{status:403})).json()).toEqual({message:'AI_MODEL_ACCESS_REVOKED'});
  expect(JSON.stringify(await safeError(Object.assign(Error('private-upstream-marker'),{status:403})).json())).not.toContain('private-upstream-marker');
 });
});
