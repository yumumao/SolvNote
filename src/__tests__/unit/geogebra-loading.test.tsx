import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.spyOn(console,"error").mockImplementation(()=>{})});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.querySelectorAll('script[src*="geogebra"]').forEach(s=>s.remove());vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
it("times out stalled script loads and retries only the display",async()=>{
 const {GeogebraDemo}=await import("@/components/geogebra-demo");await act(async()=>root.render(<GeogebraDemo commands='["A=(0,0)"]'/>));
 await act(async()=>vi.advanceTimersByTimeAsync(31000));expect(host.querySelector('[role="alert"]')?.textContent).toContain("GeoGebra");expect(host.textContent).not.toContain("加载 GeoGebra...");
 const retry=[...host.querySelectorAll("button")].find(b=>b.textContent==="重新加载演示（不调用AI）");expect(retry).toBeTruthy();
 await act(async()=>retry!.click());expect(document.querySelectorAll('script[src*="geogebra"]')).toHaveLength(1);expect(host.textContent).toContain("加载 GeoGebra...");
});
it("times out an applet that never signals ready even after the public script loaded",async()=>{
 vi.stubGlobal("GGBApplet",class {inject(){}});const {GeogebraDemo}=await import("@/components/geogebra-demo");await act(async()=>root.render(<GeogebraDemo commands='["A=(0,0)"]'/>));await act(async()=>vi.advanceTimersByTimeAsync(31000));expect(host.querySelector('[role="alert"]')?.textContent).toContain("超时");
});
it("shows a ready applet normally and resets the loading state when commands change",async()=>{
 let ready:(api:unknown)=>void=()=>{};const api={setSize:vi.fn(),evalCommand:vi.fn(),remove:vi.fn()};
 vi.stubGlobal("GGBApplet",class {constructor(options:{appletOnLoad:typeof ready}){ready=options.appletOnLoad}inject(){}});
 const {GeogebraDemo}=await import("@/components/geogebra-demo");await act(async()=>root.render(<GeogebraDemo commands='["A=(0,0)"]'/>));await act(async()=>ready(api));expect(host.textContent).not.toContain("加载 GeoGebra...");
 await act(async()=>root.render(<GeogebraDemo commands='["B=(1,1)"]'/>));expect(host.textContent).toContain("加载 GeoGebra...");await act(async()=>ready(api));await act(async()=>vi.advanceTimersByTimeAsync(31000));expect(host.querySelector('[role="alert"]')).toBeNull();expect(api.evalCommand).toHaveBeenCalledWith("B=(1,1)");
});
