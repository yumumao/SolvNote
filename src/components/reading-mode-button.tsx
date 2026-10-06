"use client";
import {Button} from './ui/button';
export function ReadingModeButton({fitWidth,onChange,disabled=false}:{fitWidth:boolean;onChange:(value:boolean)=>void;disabled?:boolean}) {
 return <Button type="button" size="sm" variant="outline" disabled={disabled} aria-pressed={fitWidth} onClick={()=>onChange(!fitWidth)} title="正文自动换行，过宽公式优先按等号、加减号分行；不可拆公式保持字号并横向查看，分享图片必要时加宽以保留完整内容">
  {fitWidth?'阅读模式：恢复原宽':'阅读模式：适合宽度'}
 </Button>;
}
