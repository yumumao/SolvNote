// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({lookup:vi.fn(),fetch:vi.fn(),agents:[] as {kind:string;options:Record<string,unknown>;destroy:ReturnType<typeof vi.fn>}[], records:[{type:1,data:"93.184.215.14"}] as {type:number;data:string}[], dnsOverride:undefined as undefined | (()=>Response)}));
vi.mock("node:dns/promises",()=>({lookup:mocks.lookup}));
vi.mock("undici",()=>({
    fetch:mocks.fetch,
    Client:class { connect(options:unknown,callback?:unknown){if(typeof callback==="function")callback(null,options);else return Promise.resolve(options);} },
    Agent:class {kind="direct";destroy=vi.fn().mockResolvedValue(undefined);close=vi.fn().mockResolvedValue(undefined);constructor(public options:Record<string,unknown>){mocks.agents.push(this);}},
    ProxyAgent:class {kind="proxy";destroy=vi.fn().mockResolvedValue(undefined);close=vi.fn().mockResolvedValue(undefined);constructor(public options:Record<string,unknown>){mocks.agents.push(this);}},
}));
import { safeAIFetch, validateAIUrl } from "@/lib/ai-url";
const endpoint="https://api.example.com/v1/chat/completions";
const proxy="http://127.0.0.1:12345";
const dnsCalls=()=>mocks.fetch.mock.calls.filter(([u])=>new URL(u).pathname==="/dns-query");
const assertPin=async(dispatcher:{options:{clientFactory:(url:URL,opts:object)=>{connect:(opts:object,cb?:unknown)=>Promise<{path:string;headers:object}>}}},authority:string)=>{
    const client=dispatcher.options.clientFactory(new URL(proxy),{});
    const result=await client.connect({path:"untrusted.example.com:443",headers:{host:"untrusted.example.com"}});
    expect(result.path).toBe(authority);expect(result.headers).toEqual({host:authority});
    const callback=vi.fn();client.connect({path:"untrusted.example.com:443"},callback);expect(callback).toHaveBeenCalledWith(null,expect.objectContaining({path:authority}));
};
const providerCalls=()=>mocks.fetch.mock.calls.filter(([u])=>new URL(u).pathname!=="/dns-query");
beforeEach(()=>{
    vi.resetAllMocks();mocks.agents.length=0;mocks.records=[{type:1,data:"93.184.215.14"}];mocks.dnsOverride=undefined;
    vi.stubEnv("AI_LOCAL_HTTPS_PROXY",proxy);
    mocks.lookup.mockResolvedValue([{address:"198.18.0.66",family:4}]);
    mocks.fetch.mockImplementation(async(input:string|URL)=>{
        const u=new URL(input);
        if(u.pathname==="/dns-query"){
            if(mocks.dnsOverride)return mocks.dnsOverride();
            const type=u.searchParams.get("type")==="AAAA"?28:1;
            return Response.json({Status:0,Question:[{name:u.searchParams.get("name"),type}],Answer:mocks.records.filter(r=>r.type===type)});
        }
        return Response.json({ok:true});
    });
});
afterEach(()=>vi.unstubAllEnvs());
describe("explicit local HTTPS proxy without weakening the public endpoint gate",()=>{
    it("bypasses Fake-IP DNS via pinned DoH and sends only to a checked numeric destination",async()=>{
        const res=await safeAIFetch(endpoint,{method:"POST",headers:{Authorization:"Bearer fixture-secret"},body:'{"fixture":true}'});
        expect(res.status).toBe(200);expect(mocks.lookup).not.toHaveBeenCalled();
        expect(dnsCalls()).toHaveLength(2);expect(providerCalls()).toHaveLength(1);
        for(const [u,opts] of dnsCalls()){
            expect(new URL(u).hostname).toBe("cloudflare-dns.com");await assertPin(opts.dispatcher,"1.1.1.1:443");
            const h=new Headers(opts.headers);expect(h.has("host")).toBe(false);expect(h.has("authorization")).toBe(false);expect(opts.body).toBeUndefined();expect(opts.redirect).toBe("error");
            expect(opts.dispatcher.options.requestTls).toMatchObject({servername:"cloudflare-dns.com",rejectUnauthorized:true});
        }
        const [u,opts]=providerCalls()[0];expect(String(u)).toBe(endpoint);await assertPin(opts.dispatcher,"93.184.215.14:443");expect(new Headers(opts.headers).has("host")).toBe(false);expect(new Headers(opts.headers).get("authorization")).toBe("Bearer fixture-secret");expect(opts.dispatcher.options).toMatchObject({uri:proxy,requestTls:{servername:"api.example.com",rejectUnauthorized:true}});expect(opts.redirect).toBe("error");
        expect(mocks.agents.filter(a=>a.kind==="direct")).toHaveLength(0);
    });
    it("keeps validation-only URLs unchanged",async()=>{expect((await validateAIUrl(endpoint)).href).toBe(endpoint);expect(providerCalls()).toHaveLength(0);});
    it("pins an IPv6-only destination and preserves Host and nondefault port",async()=>{
        mocks.records=[{type:28,data:"2606:4700:4700::1111"}];
        await safeAIFetch("https://api.example.com:8443/v1",{});
        const [u,opts]=providerCalls()[0];expect(String(u)).toBe("https://api.example.com:8443/v1");await assertPin(opts.dispatcher,"[2606:4700:4700::1111]:8443");
    });
    it("uses explicit public IP endpoints without DNS",async()=>{await safeAIFetch("https://8.8.8.8/v1",{});expect(dnsCalls()).toHaveLength(0);expect(providerCalls()).toHaveLength(1);expect(providerCalls()[0][1].dispatcher.kind).toBe("proxy");expect(mocks.lookup).not.toHaveBeenCalled();});
    it.each(["",undefined])("defaults to the strict direct path when not enabled: %s",async(value)=>{vi.stubEnv("AI_LOCAL_HTTPS_PROXY",value);vi.stubEnv("HTTPS_PROXY",proxy);await expect(safeAIFetch(endpoint,{})).rejects.toMatchObject({status:400});expect(mocks.lookup).toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();});
    it.each(["http://10.0.0.1:7890","http://localhost:7890","http://proxy.example.com:7890","https://127.0.0.1:7890","http://user:fixture-secret@127.0.0.1:7890","http://127.0.0.1:7890/path","http://127.0.0.1:7890?key=fixture-secret","http://127.0.0.1:7890/#hash"])("rejects untrusted proxy configuration before network: %s",async(value)=>{vi.stubEnv("AI_LOCAL_HTTPS_PROXY",value);const e=await safeAIFetch(endpoint,{}).catch(e=>e);expect(e).toMatchObject({status:400});expect(String(e)).not.toContain("fixture-secret");expect(mocks.fetch).not.toHaveBeenCalled();});
    it.each(["http://api.example.com","https://127.0.0.1","https://198.18.0.66","https://[::1]","https://service.internal","https://user:fixture-secret@api.example.com","https://api.example.com/?key=fixture-secret"])("does not use the proxy to admit unsafe target %s",async(value)=>{await expect(safeAIFetch(value,{})).rejects.toMatchObject({status:400});expect(mocks.fetch).not.toHaveBeenCalled();});
    it.each(["127.0.0.1","10.0.0.2","169.254.169.254","198.18.0.1","192.0.2.1","168.63.129.16"])("rejects a public+nonpublic DNS answer without dispatch: %s",async(data)=>{mocks.records.push({type:1,data});await expect(safeAIFetch(endpoint,{})).rejects.toMatchObject({status:400});expect(providerCalls()).toHaveLength(0);});
    it.each(["::1","::ffff:127.0.0.1","fc00::1","2001:db8::1"])("rejects a private IPv6 answer even with a public IPv4: %s",async(data)=>{mocks.records.push({type:28,data});await expect(safeAIFetch(endpoint,{})).rejects.toMatchObject({status:400});expect(providerCalls()).toHaveLength(0);});
    it("fails closed on DNS failure without falling back to system DNS",async()=>{mocks.fetch.mockRejectedValue(new Error("fixture-private-host"));const e=await safeAIFetch(endpoint,{}).catch(e=>e);expect(e).toMatchObject({status:400});expect(String(e)).not.toContain("fixture-");expect(mocks.lookup).not.toHaveBeenCalled();expect(providerCalls()).toHaveLength(0);expect(mocks.agents.every(a=>a.destroy.mock.calls.length===1)).toBe(true);});
    it.each([
        ()=>Response.json({Status:3}),
        ()=>Response.json({Status:0,TC:true,Answer:[{type:1,data:"93.184.215.14"}]}),
        ()=>Response.json({Status:0,Question:[{name:"wrong.example.com",type:1}],Answer:[{type:1,data:"93.184.215.14"}]}),
        ()=>new Response("fixture-bad-json"),
        ()=>new Response("x".repeat(32769)),
        ()=>new Response("{}",{status:302,headers:{Location:"http://127.0.0.1/"}}),
    ])("rejects malformed/oversized/redirected DNS case %#",async(override)=>{mocks.dnsOverride=override;await expect(safeAIFetch(endpoint,{})).rejects.toMatchObject({status:400});expect(providerCalls()).toHaveLength(0);});
    it("rejects an empty answer",async()=>{mocks.records=[];await expect(safeAIFetch(endpoint,{})).rejects.toMatchObject({status:400});expect(providerCalls()).toHaveLength(0);});
    it("does not let a caller override the pinned Host",async()=>{await expect(safeAIFetch(endpoint,{headers:{host:"127.0.0.1"}})).rejects.toMatchObject({status:502});expect(providerCalls()).toHaveLength(0);});
    it("honors a pre-aborted request before DNS or dispatch",async()=>{const signal=AbortSignal.abort();await expect(safeAIFetch(endpoint,{signal})).rejects.toThrow();expect(mocks.fetch).not.toHaveBeenCalled();});
    it("keeps Azure api-version and never redirects provider traffic",async()=>{await safeAIFetch("https://api.example.com/openai?api-version=2024-10-21",{});const [u,opts]=providerCalls()[0];expect(new URL(u).search).toBe("?api-version=2024-10-21");expect(opts.redirect).toBe("error");});
});
