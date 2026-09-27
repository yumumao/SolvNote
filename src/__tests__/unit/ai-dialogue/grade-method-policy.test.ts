// @vitest-environment node
import {describe,it,expect} from "vitest";
import {solvePrompt} from "@/lib/ai-dialogue/protocol";
import {generateAnalyzePrompt,generateGradeInstruction,generateReanswerPrompt,generateSimilarQuestionPrompt} from "@/lib/ai/prompts";
describe("grade appropriate methods are mandatory prompt policy",()=>{
 it.each(["primary_5","五年级上","小学五年级","Grade 5, 1st Semester"])("normalizes %s and shares policy with solving and review",grade=>{
  const policy=generateGradeInstruction(grade);expect(policy).toContain("小学五年级");
  for(const term of ["小学奥数","辅助线","相似","全等","sin/cos/tan","近似数值","不能仅因","复核"])expect(policy).toContain(term);
  for(const review of [false,true])expect(solvePrompt(grade,review)).toContain(policy.trim());
 });
 it("keeps shared policy in custom legacy analyze, reanswer and similar-question templates",()=>{
  const grade="primary_5",options={customTemplate:"CUSTOM: use coordinates because they are shorter",providerHints:"PROVIDER"},policy=generateGradeInstruction(grade).trim();
  for(const prompt of [generateAnalyzePrompt("zh",7,"数学",options,grade),generateReanswerPrompt("zh","synthetic","数学",options,grade),generateSimilarQuestionPrompt("zh","synthetic",[],"medium",options,grade)]){
   expect(prompt).toContain(policy);expect(prompt.indexOf(policy)).toBeGreaterThan(prompt.indexOf("CUSTOM:"));expect(prompt).toContain("sin/cos/tan");
  }
 });
 it("supports English elementary policy but does not impose it on high-school users",()=>{
  const policy=generateGradeInstruction("primary_5","en").trim();expect(policy).toContain("auxiliary lines");expect(policy).toContain("sin/cos/tan");
  expect(solvePrompt("primary_5",false,"en")).toContain(policy);expect(generateGradeInstruction("senior_high_2")).not.toContain("小学奥数");
 });
 it.each([["Junior High Grade 1, 1st Semester","初中一年级"],["Senior High Grade 2, 2nd Semester","高中二年级"],["junior_high_3","初中三年级"]])("does not misclassify %s as elementary",(grade,display)=>{
  const policy=generateGradeInstruction(grade);expect(policy).toContain(display);expect(policy).not.toContain("小学奥数");expect(policy).toContain("适龄解法");
 });
 it("reconciles supplements with existing evidence rather than demanding a complete replacement",()=>{
  const prompt=solvePrompt("primary_5");expect(prompt).toContain("user_clarified");expect(prompt).toContain("transcriptionClarifications");
  expect(prompt).toContain("不要求用户重抄完整题设");expect(prompt).toContain("只询问仍未解决的具体缺失或冲突");
 });
});
