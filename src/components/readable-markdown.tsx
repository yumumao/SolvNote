"use client";
import {useState} from 'react';
import {MarkdownRenderer} from './markdown-renderer';
import {ReadingModeButton} from './reading-mode-button';
import {SolutionShare} from './solution-share';
import type {SolutionContext} from '@/lib/solution-snapshot';
export function ReadableMarkdown({content,readingControls=true,shareContext,className=''}:{content:string;readingControls?:boolean;shareContext?:SolutionContext;className?:string}) {
 const [fitWidth,setFitWidth]=useState(false);
 return <div className="min-w-0 space-y-3">
  {readingControls&&<ReadingModeButton fitWidth={fitWidth} onChange={setFitWidth}/>}
  {shareContext&&<SolutionShare analysis={content} {...shareContext} fitWidth={fitWidth}/>}
  <MarkdownRenderer className={className} content={content} fitWidth={fitWidth}/>
 </div>;
}
