import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AIProcess} from "@/components/ai-process";
import type {ProcessStep} from "@/lib/ai-dialogue/types";
let host:HTMLDivElement,root:Root;
const step=(id:string,state='running',finishedAt:string|null=null):ProcessStep=>({id,modelId:'synthetic',stage:'solve',state,startedAt:`2026-10-03T00:00:0${id}.000Z`,finishedAt});
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()});
async function render(steps:ProcessStep[],active=true){await act(async()=>root.render(<AIProcess steps={steps} messages={[]} active={active}/>));}
it('places a compact indeterminate bar below the current step and nowhere else',async()=>{await render([step('1','success','2026-10-03T00:00:02Z'),step('2')]);const bars=host.querySelectorAll('[role=progressbar]');expect(bars).toHaveLength(1);expect(bars[0].closest('li')).toBe(host.querySelectorAll('li')[1]);expect(bars[0].getAttribute('aria-label')).toContain('解题');expect(bars[0].hasAttribute('aria-valuenow')).toBe(false);expect(bars[0].className).toContain('h-1');});
it('selects only newest step by time even with older running snapshots in unsorted input',async()=>{await render([step('3'),step('1'),step('2')]);expect(host.querySelectorAll('[role=progressbar]')).toHaveLength(1);expect(host.querySelector('[role=progressbar]')?.closest('li')).toBe(host.querySelectorAll('li')[2]);});
it.each(['success','failed','cancelled','unknown'])('does not animate older running records if the latest is %s',async state=>{await render([step('1'),step('2',state)]);expect(host.querySelector('[role=progressbar]')).toBeNull();});
it('stops after parent becomes inactive, cancellation, or poll error even with a stale running record',async()=>{await render([step('1')]);expect(host.querySelector('[role=progressbar]')).not.toBeNull();await render([step('1')],false);expect(host.querySelector('[role=progressbar]')).toBeNull();});
it('does not animate finished running records, empty lists or inactive history by default',async()=>{await render([step('1','running','2026-10-03T00:00:02Z')]);expect(host.querySelector('[role=progressbar]')).toBeNull();await render([]);expect(host.querySelector('[role=progressbar]')).toBeNull();await act(async()=>root.render(<AIProcess steps={[step('1')]} messages={[]}/>));expect(host.querySelector('[role=progressbar]')).toBeNull();});
