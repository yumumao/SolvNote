// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RECOGNIZE_PROMPT, solvePrompt, DecisionSchema, parseJSON } from "@/lib/ai-dialogue/protocol";
describe("dialogue keeps notebook teaching requirements",()=>{
 it("requests separate markdown fields, complete tables and pedagogical steps without changing the control protocol",()=>{
  const prompt=solvePrompt("primary_5");
  for(const text of ["Markdown","LaTeX","### 解题思路","### 分步解答","### 检验与总结","表格","mistakeAnalysis","needs_visual_check","needs_user","严格JSON","年级","内部思维链"])expect(prompt).toContain(text);
  expect(prompt).not.toContain("严禁使用 JSON");expect(prompt).not.toContain("<question_text>");
  expect(prompt).toContain("完整参考答案");expect(prompt).toContain("不得编造学生错误");
 });
 it("prefers the least advanced sound method with purposeful geometry steps",()=>{
  const prompt=solvePrompt("五年级");
  for(const text of ["最低必要知识", "逐级", "平面几何", "旋转", "全等", "坐标", "构造目的", "不能只靠", "不得强行"])expect(prompt).toContain(text);
 });
 it("retains student work as evidence during visual transcription, even for text-only solvers",()=>{
  for(const text of ["学生作答","原题","推断","表格","LaTeX"])expect(RECOGNIZE_PROMPT).toContain(text);
 });
 it("gives a valid JSON-escaped math example that decodes to real LaTeX",()=>{
  expect(solvePrompt()).toContain(String.raw`{"answerText":"$\\frac{1}{2}$"}`);
  const result={questionText:"synthetic",answerText:String.raw`$\frac{1}{2}$`,analysis:"### 分步解答\n"+String.raw`$a \neq b$`,subject:"数学",knowledgePoints:[]};
  const decoded=parseJSON(JSON.stringify({status:"solved",result}),DecisionSchema);
  expect(decoded.status).toBe("solved");if(decoded.status==="solved")expect(decoded.result.analysis).toContain(String.raw`\neq`);
 });
});
