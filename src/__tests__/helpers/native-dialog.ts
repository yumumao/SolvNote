import {vi} from "vitest";
// jsdom does not implement the browser top layer. Real focus/inert/scroll tests run in Edge.
export function mockNativeDialog(){
 const proto=HTMLDialogElement.prototype;
 const show=Object.getOwnPropertyDescriptor(proto,"showModal"),close=Object.getOwnPropertyDescriptor(proto,"close");
 Object.defineProperty(proto,"showModal",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.setAttribute("open","");})});
 Object.defineProperty(proto,"close",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.removeAttribute("open");this.dispatchEvent(new Event("close"));})});
 return ()=>{if(show)Object.defineProperty(proto,"showModal",show);else delete (proto as Partial<HTMLDialogElement>).showModal;if(close)Object.defineProperty(proto,"close",close);else delete (proto as Partial<HTMLDialogElement>).close;};
}
