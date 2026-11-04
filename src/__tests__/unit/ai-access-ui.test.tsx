import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PrivateAISettings} from "@/components/private-ai-settings";
import {AIAccessPanel} from "@/components/ai-access-panel";
import {AIModelOrderSettings} from "@/components/ai-model-order-settings";
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
 expect(JSON.parse(call[1].body)).toEqual({revision:9,defaultModelIds:["m1","m2","m3"],allowedModelIds:["m1","m2","m3","m4"],defaultChains:{text:["m1","m2","m3"],vision:[]}});
});
it("member moves built-in and personal models independently and submits no configuration fields",async()=>{
 const revisions={site:1,policy:2,private:3,order:4};
 const models=[{id:"a",name:"Built-in A",source:"site",capabilities:["text","vision"]},{id:"b",name:"Built-in B",source:"site",capabilities:["text"]},{id:"private/p",name:"Personal",source:"private",capabilities:["text","vision"]}];
 fetcher.mockImplementation(async()=>Response.json({models,chains:{text:["a","b","private/p"],vision:["a","private/p"]},revisions}));
 await act(async()=>root.render(<AIModelOrderSettings refreshKey={3}/>));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="解题顺序：上移Personal"]')!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="读图顺序：上移Personal"]')!.click());
 await act(async()=>button("保存调用顺序").click());
 const call=fetcher.mock.calls.find(([,init])=>init?.method==="PATCH")!;
 expect(JSON.parse(call[1].body)).toEqual({revisions,chains:{text:["a","private/p","b"],vision:["private/p","a"]}});
});
it("ordinary model editor starts with non-removable text and optional vision",async()=>{
 await act(async()=>root.render(<PrivateAISettings/>));
 expect(host.textContent).toContain("文字 ✓（默认）");
 expect([...host.querySelectorAll("label")].some(label=>label.textContent==="文本")).toBe(false);
 expect([...host.querySelectorAll("label")].some(label=>label.textContent==="读图")).toBe(true);
});
it("preserves legacy vision-only models until text is explicitly enabled",async()=>{
 fetcher.mockImplementation(async(url)=>Response.json(url==="/api/user/ai-config"?{revision:7,config:{...config,models:[{...config.models[0],capabilities:["vision"]}]}}:{models:[],chains:{text:[],vision:[]}}));
 await act(async()=>root.render(<PrivateAISettings/>));expect(host.textContent).toContain("仅图片（旧配置保留）");
 await act(async()=>button("允许文字输入").click());expect(host.textContent).toContain("文字 ✓（默认）");
 await act(async()=>button("保存私有AI").click());
 const call=fetcher.mock.calls.find(([,init])=>init?.method==="PUT")!;
 expect(JSON.parse(call[1].body).config.models[0].capabilities).toEqual(["text","vision"]);
});
