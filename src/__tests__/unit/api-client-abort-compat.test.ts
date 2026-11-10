// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {apiClient} from '@/lib/api-client';

const nativeAny=Object.getOwnPropertyDescriptor(AbortSignal,'any');
beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(AbortSignal,'any',{value:undefined,configurable:true,writable:true});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();if(nativeAny)Object.defineProperty(AbortSignal,'any',nativeAny);});
const ok=()=>new Response(JSON.stringify({items:[],total:0,page:1,pageSize:20}));
function pendingFetch(){
 const fetchMock=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  const signal=options.signal!;if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }));vi.stubGlobal('fetch',fetchMock);return fetchMock;
}
describe('requests on browsers without AbortSignal.any',()=>{
 it('loads notices with a caller signal and releases its listener',async()=>{
  const caller=new AbortController(),add=vi.spyOn(caller.signal,'addEventListener'),remove=vi.spyOn(caller.signal,'removeEventListener');
  const fetchMock=vi.fn().mockResolvedValue(ok());vi.stubGlobal('fetch',fetchMock);
  expect(await apiClient.get('/api/announcements',{signal:caller.signal})).toMatchObject({items:[]});
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(add).toHaveBeenCalledWith('abort',expect.any(Function),{once:true});
  expect(remove).toHaveBeenCalledWith('abort',add.mock.calls[0][1]);expect(vi.getTimerCount()).toBe(0);
 });
 it('preserves caller cancellation and does not retry',async()=>{
  const caller=new AbortController(),fetchMock=pendingFetch();
  const result=apiClient.get('/api/announcements',{signal:caller.signal});const rejected=expect(result).rejects.toMatchObject({status:408});
  caller.abort();await rejected;expect(fetchMock).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('honors an already aborted signal without sending a request successfully',async()=>{
  const caller=new AbortController();caller.abort();const fetchMock=pendingFetch();
  await expect(apiClient.get('/api/announcements',{signal:caller.signal})).rejects.toMatchObject({status:408});
  expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
 });
 it('retains the default 60 second timeout with a caller signal',async()=>{
  const caller=new AbortController(),fetchMock=pendingFetch();const result=apiClient.get('/api/announcements',{signal:caller.signal});
  const rejected=expect(result).rejects.toMatchObject({status:408});
  await vi.advanceTimersByTimeAsync(59999);expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await rejected;expect(caller.signal.aborted).toBe(false);expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('cleans up on an HTTP failure and preserves its status',async()=>{
  const caller=new AbortController(),remove=vi.spyOn(caller.signal,'removeEventListener');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"message":"Access denied"}',{status:403})));
  await expect(apiClient.get('/api/announcements',{signal:caller.signal})).rejects.toMatchObject({status:403});
  expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(vi.getTimerCount()).toBe(0);
 });
 it('polls an accepted AI job without resubmitting after fallback',async()=>{
  const caller=new AbortController(),fetchMock=vi.fn().mockResolvedValueOnce(new Response('{"jobId":"synthetic-job"}',{status:202})).mockResolvedValueOnce(new Response('{"state":"success","result":{"answer":"ok"}}'));
  vi.stubGlobal('fetch',fetchMock);expect(await apiClient.post('/api/analyze',{}, {signal:caller.signal})).toEqual({answer:'ok'});
  expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][0]).toBe('/api/ai/jobs/synthetic-job');expect(vi.getTimerCount()).toBe(0);
 });
 it('stops waiting for an accepted AI job when cancelled without submitting or cancelling it again',async()=>{
  const caller=new AbortController(),fetchMock=vi.fn().mockResolvedValue(new Response('{"jobId":"synthetic-job"}',{status:202}));vi.stubGlobal('fetch',fetchMock);
  await expect(apiClient.post('/api/analyze',{}, {signal:caller.signal,onJobAccepted:()=>caller.abort()})).rejects.toMatchObject({status:499,data:{message:'AI_POLLING_STOPPED_JOB_CONTINUES'}});
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
});
