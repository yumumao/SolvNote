import { diagnosticMessage } from "./ai/diagnostics";
type RequestOptions=RequestInit&{params?:Record<string,string>;timeout?:number;onJobAccepted?:(jobId:string)=>void};
export class ApiError extends Error{constructor(public status:number,public statusText:string,public data:unknown){super(`API Error: ${status} ${statusText}`);this.name='ApiError'}}
export async function waitForAIJob<T>(id:string,signal?:AbortSignal):Promise<T>{
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'Invalid job',{});
 const deadline=Date.now()+24*60*60*1000;
 while(Date.now()<deadline){
 if(signal?.aborted)throw new ApiError(499,'Polling stopped',{message:'AI_POLLING_STOPPED_JOB_CONTINUES',jobId:id});
 const job=await request<{state:string;result:T;errorCode?:string;attemptsLog?:Array<{state?:string;errorCode?:string;diagnostic?:string}>}>(`/api/ai/jobs/${id}`,{signal,timeout:30000});
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('ai-job-progress',{detail:{id,state:job.state}}));
 if(job.state==='success')return job.result;
 if(['failed','cancelled','unknown'].includes(job.state)){
 // Carry only the final matching terminal diagnostic (or final parse failure wrapped by budget exhaustion).
 // Never reuse an earlier failure after access revocation/cancellation or echo upstream text.
 const last=Array.isArray(job.attemptsLog)?job.attemptsLog.at(-1):undefined;
 const diagnostic=job.errorCode && last && ['failed','unknown'].includes(last.state||'') && (last.errorCode===job.errorCode || (job.errorCode==='AI_BUDGET_EXHAUSTED' && last.state==='failed' && ['AI_RESPONSE_ERROR','AI_DRAWING_INVALID'].includes(last.errorCode||''))) && diagnosticMessage(last.diagnostic)?last.diagnostic:undefined;
 throw new ApiError(422,'AI task stopped',{message:job.errorCode||`AI_${job.state.toUpperCase()}`,jobId:id,...(diagnostic?{diagnostic}:{})});
 }
 await new Promise(r=>setTimeout(r,2000));
 }
 throw new ApiError(408,'Task expired',{message:'AI_JOB_EXPIRED',jobId:id});
}
async function request<T>(url:string,options:RequestOptions={}):Promise<T>{
 const {params,headers,timeout=60000,signal:callerSignal,onJobAccepted,...rest}=options;
 const finalUrl=params?`${url}?${new URLSearchParams(params)}`:url;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 const mergedHeaders=new Headers(headers);if(!mergedHeaders.has('Content-Type'))mergedHeaders.set('Content-Type','application/json');
 if(rest.method==='POST'&&!mergedHeaders.has('X-Request-ID'))mergedHeaders.set('X-Request-ID',crypto.randomUUID());
 try{
 const res=await fetch(finalUrl,{...rest,headers:mergedHeaders,signal:callerSignal?AbortSignal.any([callerSignal,controller.signal]):controller.signal});
 const text=await res.text();let data:unknown;try{data=text?JSON.parse(text):{}}catch{data=text}
 clearTimeout(timer);
 if(!res.ok)throw new ApiError(res.status,res.statusText,data);
 if(res.status===202){
 const accepted=data as {jobId:string};if(typeof accepted.jobId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(accepted.jobId))throw new ApiError(502,'Invalid task response',{});
 onJobAccepted?.(accepted.jobId);
 if(typeof window!=='undefined'){try{localStorage.setItem('last-ai-job',accepted.jobId)}catch{}window.dispatchEvent(new CustomEvent('ai-job-progress',{detail:{id:accepted.jobId,state:'pending'}}))}
 return await waitForAIJob<T>(accepted.jobId,callerSignal||undefined);
 }
 return data as T;
 }catch(e){if(e instanceof Error&&e.name==='AbortError')throw new ApiError(408,'Request Timeout',{message:'AI_REQUEST_TIMEOUT_CHECK_TASKS'});throw e}finally{clearTimeout(timer)}
}
export const apiClient={
 get:<T>(url:string,options?:RequestOptions)=>request<T>(url,{...options,method:'GET'}),
 post:<TResponse,TBody=unknown>(url:string,body:TBody,options?:RequestOptions)=>request<TResponse>(url,{...options,method:'POST',body:JSON.stringify(body)}),
 put:<TResponse,TBody=unknown>(url:string,body:TBody,options?:RequestOptions)=>request<TResponse>(url,{...options,method:'PUT',body:JSON.stringify(body)}),
 patch:<TResponse,TBody=unknown>(url:string,body:TBody,options?:RequestOptions)=>request<TResponse>(url,{...options,method:'PATCH',body:JSON.stringify(body)}),
 delete:<T>(url:string,options?:RequestOptions)=>request<T>(url,{...options,method:'DELETE'}),
};
