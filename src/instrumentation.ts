export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {setupGlobalProxy}=await import('./lib/global-proxy');setupGlobalProxy();
  if(process.env.NEXT_PHASE!=='phase-production-build'){
   const {startAIWorker}=await import('./lib/ai-jobs/worker');startAIWorker();
   const {startUserRetentionWorker}=await import('./lib/user-management/purge-expired-users');startUserRetentionWorker();
  }
 }
}
