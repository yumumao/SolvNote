import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import RecordsPage from "@/app/solving-records/page";
import {SolvingStats} from "@/components/solving-stats";
const {get}=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/api-client",()=>({apiClient:{get}}));
vi.mock("@/contexts/LanguageContext",()=>({useLanguage:()=>({language:"zh",t:{}})}));
vi.mock("@/components/ui/back-button",()=>({BackButton:()=>null}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);get.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const click=async(text:string)=>{const b=[...host.querySelectorAll("button")].find(b=>b.textContent===text);expect(b).toBeDefined();await act(async()=>b!.click());};
const record={key:"c:one",id:"one",kind:"conversation",title:"Synthetic question",state:"awaiting_user",status:"awaiting",createdAt:"2026-09-25T00:00:00Z",updatedAt:"2026-09-25T00:00:00Z",roundsUsed:2};
const recordLink=()=>[...host.querySelectorAll("a")].find(a=>a.textContent==="Synthetic question");
describe("solving records UI",()=>{
 it("opens existing records, pages and filters without submitting AI",async()=>{
  get.mockResolvedValueOnce({records:[record],nextCursor:"next"}).mockResolvedValue({records:[{...record,key:"j:two",id:"two",kind:"analyze"}],nextCursor:null});
  await act(async()=>root.render(<RecordsPage/>));
  expect(recordLink()?.getAttribute("href")).toBe("/ai-dialogue/one");
  await click("下一页");
  expect(get).toHaveBeenCalledWith(expect.stringContaining("cursor=next"),expect.anything());
  expect(recordLink()?.getAttribute("href")).toBe("/ai-tasks?job=two");
  await act(async()=>{const select=host.querySelector("select")!;select.value="awaiting";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(get).toHaveBeenCalledWith("/api/solving-records?status=awaiting",expect.anything());
 });
 it("shows recoverable errors and empty records",async()=>{
  get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({records:[],nextCursor:null});
  await act(async()=>root.render(<RecordsPage/>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法加载");
  await click("刷新");
  expect(host.textContent).toContain("暂无解题记录");
 });
 it("separates completed records, review practice and AI calls",async()=>{
  get.mockResolvedValue({total:108,completed:106,awaiting:1,processing:0,failed:1,cancelled:0,aiCalls:214,months:[{month:"2026-09",count:108}]});
  await act(async()=>root.render(<SolvingStats/>));
  expect([...host.querySelectorAll("dd")].map(e=>e.textContent)).toEqual(["108","106","1","0","1","0","214"]);
  expect(host.textContent).toContain("已完成不代表答案正确");
 });
 it("polls without overlap and ignores stale responses after a filter change",async()=>{
  let finish!:(v:unknown)=>void;
  get.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue({records:[],nextCursor:null});
  await act(async()=>root.render(<RecordsPage/>));
  await act(async()=>vi.advanceTimersByTimeAsync(6000));expect(get).toHaveBeenCalledTimes(1);
  await act(async()=>{const select=host.querySelector("select")!;select.value="awaiting";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await act(async()=>finish({records:[record],nextCursor:null}));
  expect(recordLink()).toBeUndefined();
  await act(async()=>vi.advanceTimersByTimeAsync(3000));expect(get).toHaveBeenCalledTimes(3);
 });
});
