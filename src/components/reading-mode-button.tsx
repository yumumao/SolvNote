"use client";
import {Button} from './ui/button';
export function ReadingModeButton({fitWidth,onChange,disabled=false}:{fitWidth:boolean;onChange:(value:boolean)=>void;disabled?:boolean}) {
 return <Button type="button" size="sm" variant="outline" disabled={disabled} aria-pressed={fitWidth} onClick={()=>onChange(!fitWidth)} title="正文自动换行，过宽公式按可用宽度缩放；分享图片沿用此布局">
  {fitWidth?'阅读模式：恢复原宽':'阅读模式：适合宽度'}
 </Button>;
}
