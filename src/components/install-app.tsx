"use client";

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {Language} from '@/lib/translations';
import {Button} from './ui/button';

type InstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{outcome:'accepted'|'dismissed'}>;
};
const displayMode = '(display-mode: standalone)';
function isStandalone() {
    return Boolean(window.matchMedia?.(displayMode).matches || (navigator as Navigator & {standalone?:boolean}).standalone);
}
function subscribeDisplayMode(notify:()=>void) {
    const media=window.matchMedia?.(displayMode);
    media?.addEventListener('change',notify);
    return ()=>media?.removeEventListener('change',notify);
}
const serverStandalone = ()=>false;

/** Optional install UI only: no service worker, request interception or data cache. */
export function InstallApp({language}:{language:Language}) {
    const en=language==='en';
    const standalone=useSyncExternalStore(subscribeDisplayMode,isStandalone,serverStandalone);
    const [deferred,setDeferred]=useState<InstallPromptEvent|null>(null);
    const [installed,setInstalled]=useState(false);
    const [outcome,setOutcome]=useState<'accepted'|'dismissed'|'failed'|null>(null);
    const prompting=useRef(false);
    useEffect(()=>{
        const capture=(raw:Event)=>{
            const event=raw as InstallPromptEvent;
            if(isStandalone() || typeof event.prompt!=='function' || !event.userChoice)return;
            event.preventDefault();setDeferred(event);setOutcome(null);
        };
        const complete=()=>{setInstalled(true);setDeferred(null);};
        window.addEventListener('beforeinstallprompt',capture);
        window.addEventListener('appinstalled',complete);
        return ()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',complete);};
    },[]);
    async function install() {
        if(!deferred || prompting.current)return;
        prompting.current=true;
        const event=deferred;setDeferred(null);setOutcome(null);
        try {await event.prompt();setOutcome((await event.userChoice).outcome);}
        catch {setOutcome('failed');}
        finally {prompting.current=false;}
    }
    if(standalone || installed)return null;
    return <details data-install-app className="mx-auto max-w-md text-left">
        <summary className="cursor-pointer text-center underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{en?'Install app':'安装应用'}</summary>
        <div className="mt-2 space-y-2 rounded-md border bg-background p-3 text-sm text-foreground">
            <p>{en?'Add SolvNote to your Home Screen and open it as an app. An internet connection is required.':'将解迹添加到手机主屏幕，像应用一样打开。使用时仍需联网。'}</p>
            {deferred && <Button type="button" variant="outline" size="sm" onClick={()=>void install()}>{en?'Install on this device':'安装到设备'}</Button>}
            {outcome && <p role="status">{outcome==='accepted'?(en?'Installation requested. Follow your device’s instructions.':'已提交安装请求，请按设备提示完成。'):outcome==='dismissed'?(en?'Installation cancelled. You can still use the website normally.':'已取消安装，可继续正常使用网站。'):(en?'Could not open the install prompt. Use the browser menu below.':'未能打开安装窗口，请使用下方浏览器菜单安装。')}</p>}
            <ul className="list-disc space-y-1 pl-5">
                <li>{en?'Android: open in Chrome, then choose Install app or Add to Home screen from the browser menu.':'安卓：用Chrome打开，在浏览器菜单中选择“安装应用”或“添加到主屏幕”。'}</li>
                <li>{en?'iPhone / iPad: open in Safari, tap Share → Add to Home Screen, keep Open as Web App enabled if shown, then tap Add.':'iPhone / iPad：用Safari打开，点“分享”→“添加到主屏幕”；如显示“作为网页App打开”，保持开启，再点“添加”。'}</li>
            </ul>
            <p className="text-xs text-muted-foreground">{en?'Inside another app, first open this page in your system browser. If no install option appears, you can keep using the website.':'在微信等应用内打开时，请先选择用系统浏览器打开。没有安装选项时，仍可正常使用网页版。'}</p>
        </div>
    </details>;
}
