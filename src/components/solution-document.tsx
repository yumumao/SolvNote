import styles from "./solution-document.module.css";
import type {ReactNode} from "react";
import {MarkdownRenderer} from "./markdown-renderer";
import {ConstructionDiagram} from "./construction-diagram";
import {compileConstruction,type ConstructionPlan} from "@/lib/ai-drawing/construction";
import {localSolutionImage,type SolutionSnapshot} from "@/lib/solution-snapshot";
export type {SolutionContext,SolutionSnapshot} from "@/lib/solution-snapshot";
/** Only explicit snapshot fields are rendered. Never accept a question/account object. */
export function SolutionDocument({snapshot}:{snapshot:SolutionSnapshot}){
 const heading=(title:string)=><h2 style={{fontSize:20,fontWeight:700,margin:'14px 0 6px'}}>{title}</h2>;
 const section=(title:string,content:string):ReactNode=><section data-solution-section>{heading(title)}<MarkdownRenderer content={content} fitWidth={snapshot.fitWidth} localShare/></section>;
 const drawing=(title:string,plan:ConstructionPlan)=><section data-solution-section>{heading(title)}<div data-solution-attachment={title}><ConstructionDiagram geometry={compileConstruction(plan).geometry} visible={plan.steps.length} title={title} readOnly compact/></div></section>;
 return <article className={styles.document} data-solution-document data-fit-width={!!snapshot.fitWidth} lang="zh-CN" style={{background:'#fff',color:'#172554',padding:16,lineHeight:1.8,overflowWrap:'anywhere',fontSize:16,textAlign:'left',colorScheme:'light'}}>
  <h1 style={{fontSize:24,fontWeight:700,margin:'0 0 16px'}}>解题思路与步骤</h1>
  {snapshot.includeQuestion&&snapshot.questionText?.trim()&&section('题目',snapshot.questionText)}
  {snapshot.includeOriginal&&localSolutionImage(snapshot.originalImage)&&<section data-solution-section>{heading('原图')}<figure data-solution-attachment="原图" style={{margin:0}}>
   {/* eslint-disable-next-line @next/next/no-img-element -- validated local raster attachment */}
   <img src={snapshot.originalImage} alt="原图" style={{display:'block',maxWidth:'100%',maxHeight:960,width:'auto',height:'auto',objectFit:'contain',objectPosition:'left top'}}/>
  </figure></section>}
  {snapshot.includeBase&&snapshot.basePlan&&drawing('原题重绘',snapshot.basePlan)}
  {snapshot.includeAnswer&&snapshot.answerText?.trim()&&section('参考答案',snapshot.answerText)}
  {snapshot.includeAuxiliary&&snapshot.auxiliaryPlan&&drawing('辅助线图',snapshot.auxiliaryPlan)}
  {section('解题过程',snapshot.analysis)}
  <footer style={{fontSize:12,color:'#64748b',marginTop:24}}>SolvNote · 解题过程快照，请核对公式、推导与示意图。</footer>
 </article>;
}
