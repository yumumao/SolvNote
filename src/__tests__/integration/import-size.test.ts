import {describe,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({user:{findUnique:vi.fn().mockResolvedValue({id:'synthetic-user',email:'test@example.invalid'})},$transaction:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:db}));
vi.mock('@/lib/auth',()=>({authOptions:{}}));
vi.mock('next-auth',()=>({getServerSession:async()=>({user:{id:'synthetic-user',email:'test@example.invalid',role:'user'}})}));
vi.mock('@/lib/logger',()=>({createLogger:()=>({error:vi.fn(),info:vi.fn()})}));
import {POST} from '@/app/api/import/route';

describe('import request size boundary',()=>{
 it.each([undefined,'1'])('limits actual streamed bytes despite Content-Length=%s',async declared=>{
  let chunks=0;
  const cancel=vi.fn();
  const block=new Uint8Array(1024*1024).fill(32);
  const body=new ReadableStream<Uint8Array>({pull(controller){if(chunks++<60)controller.enqueue(block);else controller.close();},cancel});
  const headers=new Headers({'content-type':'application/json'});
  if(declared) headers.set('content-length',declared);
  const req=new Request('https://example.invalid/api/import',{method:'POST',headers,body,duplex:'half'} as RequestInit);
  const res=await POST(req);
  expect(res.status).toBe(413);
  expect(cancel).toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
 });
});
