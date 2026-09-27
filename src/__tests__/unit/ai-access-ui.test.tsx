import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PrivateAISettings} from "@/components/private-ai-settings";
import {AIAccessPanel} from "@/components/ai-access-panel";
const config={version:1,providers:[{id:"p",name:"Personal",protocol:"chat",baseUrl:"https://example.invalid/v1",enabled:true,hasKey:true}],models:[{id:"m",providerId:"p",name:"Mine",model:"model",capabilities:["text"],enabled:true}],chains:{text:["m"],vision:[]}};
let root:Root,host:HTMLDivElement;
const fetcher=vi.fn();
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",fetcher);fetcher.mockReset().mockImplementation(async(url)=>Response.json(url==="/api/user/ai-config"?{revision:7,config}:{models:[],chains:{text:[],vision:[]}}));host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(name:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===name)!;
it("edits redacted private config with CAS and an explicit keep-key mask; has no export",async()=>{
 await act(async()=>root.render(<PrivateAISettings/>));expect(host.textContent).not.toContain("导出配置");
 expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
 await act(async()=>button("保存私有AI").click());
 const mutation=fetcher.mock.calls.find(([,init])=>init?.method==="PUT")!;const body=JSON.parse(mutation[1].body);
 expect(body.revision).toBe(7);expect(body.config.providers[0].apiKey).toBe("********");expect(body.config.providers[0]).not.toHaveProperty("hasKey");
});
it("keeps a stale editor visible and asks to reload instead of silently overwriting",async()=>{
 await act(async()=>root.render(<PrivateAISettings/>));fetcher.mockResolvedValueOnce(Response.json({}, {status:409}));
 await act(async()=>button("保存私有AI").click());expect(host.textContent).toContain("配置已被修改");expect([...host.querySelectorAll("input")].some(input=>input.value==="Mine")).toBe(true);
});
it("admin policy submits exactly three defaults and a policy revision",async()=>{
 const models=[1,2,3,4].map(n=>({id:`m${n}`,name:`Model ${n}`,model:`model${n}`,providerName:"Site",capabilities:["text"],isAllowed:true,defaultRank:n<=3?n:null}));
 fetcher.mockImplementation(async()=>Response.json({revision:9,models,defaultModelIds:["m1","m2","m3"]}));
 await act(async()=>root.render(<AIAccessPanel/>));expect(button("保存站点权限").disabled).toBe(false);
 await act(async()=>button("保存站点权限").click());const call=fetcher.mock.calls.find(([,init])=>init?.method==="PATCH")!;
 expect(JSON.parse(call[1].body)).toEqual({revision:9,defaultModelIds:["m1","m2","m3"],allowedModelIds:["m1","m2","m3","m4"]});
});
