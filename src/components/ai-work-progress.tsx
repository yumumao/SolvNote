"use client";
import {useId} from "react";
import styles from "./ai-work-progress.module.css";

/** Activity indicator only: providers do not expose a measured percentage. */
export function AIWorkProgress({active,label,compact=false}:{active:boolean;label:string;compact?:boolean}){
    const descriptionId=useId();
    if(!active)return null;
    return <div className={compact?"mt-2 max-w-md space-y-1":"space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/30"}>
        {!compact&&<p className="text-sm font-medium">{label}进行中，请稍候…</p>}
        <div role="progressbar" aria-label={label} aria-valuetext="处理中，完成进度未知" aria-describedby={descriptionId} className={`${compact?"h-1.5":"h-2"} w-full overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900`}>
            <span aria-hidden="true" className={`${styles.indicator} rounded-full bg-sky-500 dark:bg-sky-400`}/>
        </div>
        <p id={descriptionId} className={compact?"sr-only":"text-xs text-muted-foreground"}>动画仅表示正在等待结果，不代表实际完成比例；请勿重复提交。</p>
    </div>;
}
