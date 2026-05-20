module.exports=[22734,(e,n,t)=>{n.exports=e.x("fs",()=>require("fs"))},98003,e=>{"use strict";var n=e.i(22734),t=e.i(14747);let i=(0,e.i(50377).createLogger)("config"),s=t.default.join(process.cwd(),"config","app-config.json"),r={aiProvider:process.env.AI_PROVIDER||"gemini",allowRegistration:!0,openai:{instances:process.env.OPENAI_API_KEY?[{id:"env-default",name:"Default (ENV)",apiKey:process.env.OPENAI_API_KEY,baseUrl:process.env.OPENAI_BASE_URL||"https://api.openai.com/v1",model:process.env.OPENAI_MODEL||"gpt-4o"}]:[],activeInstanceId:process.env.OPENAI_API_KEY?"env-default":void 0},gemini:{apiKey:process.env.GOOGLE_API_KEY,baseUrl:process.env.GEMINI_BASE_URL,model:process.env.GEMINI_MODEL||"gemini-2.5-flash"},azure:{apiKey:process.env.AZURE_OPENAI_API_KEY,endpoint:process.env.AZURE_OPENAI_ENDPOINT,deploymentName:process.env.AZURE_OPENAI_DEPLOYMENT,apiVersion:process.env.AZURE_OPENAI_API_VERSION||"2024-02-15-preview",model:process.env.AZURE_OPENAI_MODEL||"gpt-4o"},prompts:{analyze:"",similar:""},timeouts:{analyze:18e4}};function a(){if(n.default.existsSync(s))try{var e;let t=n.default.readFileSync(s,"utf-8"),a=JSON.parse(t),o=a.openai;if((e=a.openai)&&"object"==typeof e&&"apiKey"in e&&!("instances"in e)){i.info("Detected legacy OpenAI config, migrating to multi-instance format..."),o=function(e){if(!e.apiKey)return{instances:[],activeInstanceId:void 0};let n={id:"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,e=>{let n=16*Math.random()|0;return("x"===e?n:3&n|8).toString(16)}),name:"Default",apiKey:e.apiKey,baseUrl:e.baseUrl||"https://api.openai.com/v1",model:e.model||"gpt-4o"};return{instances:[n],activeInstanceId:n.id}}(a.openai);let e={...a,openai:o};n.default.writeFileSync(s,JSON.stringify(e,null,2)),i.info("Legacy OpenAI config migrated successfully")}return{...r,...a,openai:{instances:o?.instances||r.openai?.instances||[],activeInstanceId:o?.activeInstanceId||r.openai?.activeInstanceId},gemini:{...r.gemini,...a.gemini},azure:{...r.azure,...a.azure},prompts:{...r.prompts,...a.prompts},timeouts:{...r.timeouts,...a.timeouts}}}catch(e){i.error({error:e},"Failed to read config file")}return r}function o(e){let t=a(),r={...t,...e,openai:{instances:e.openai?.instances??t.openai?.instances??[],activeInstanceId:e.openai?.activeInstanceId??t.openai?.activeInstanceId},gemini:{...t.gemini,...e.gemini},azure:{...t.azure,...e.azure},prompts:{...t.prompts,...e.prompts},timeouts:{...t.timeouts,...e.timeouts}};try{return n.default.writeFileSync(s,JSON.stringify(r,null,2)),r}catch(e){throw i.error({error:e},"Failed to write config file"),e}}function l(){let e=a(),n=e.openai?.instances||[],t=e.openai?.activeInstanceId;if(t&&0!==n.length)return n.find(e=>e.id===t)}e.s(["getActiveOpenAIConfig",()=>l,"getAppConfig",()=>a,"updateAppConfig",()=>o])},46786,(e,n,t)=>{n.exports=e.x("os",()=>require("os"))},81111,(e,n,t)=>{n.exports=e.x("node:stream",()=>require("node:stream"))},4446,(e,n,t)=>{n.exports=e.x("net",()=>require("net"))},55004,(e,n,t)=>{n.exports=e.x("tls",()=>require("tls"))},30166,e=>{"use strict";function n(e,n){return(n||"").trim()?"wrong_attempt":"not_attempted"===e||"wrong_attempt"===e||"unknown"===e?e:"unknown"}e.s(["normalizeMistakeStatusForSave",()=>n])},5898,e=>{"use strict";function n(e){if(!e)return null;let n=e.toLowerCase();return n.startsWith("primary")||n.includes("小学")||n.match(/[一二三四五六]年级/)?null:n.includes("初一")||n.includes("七年级")||n.includes("7年级")||"junior_high_1"===n?7:n.includes("初二")||n.includes("八年级")||n.includes("8年级")||"junior_high_2"===n?8:n.includes("初三")||n.includes("九年级")||n.includes("9年级")||"junior_high_3"===n?9:n.includes("高一")||n.includes("10年级")||"senior_high_1"===n?10:n.includes("高二")||n.includes("11年级")||"senior_high_2"===n?11:n.includes("高三")||n.includes("12年级")||"senior_high_3"===n?12:null}function t(e){if(!e)return null;let n=e.match(/primary[_\s]?(\d)/);if(n)return`小学${({1:"一",2:"二",3:"三",4:"四",5:"五",6:"六"})[n[1]]||n[1]}年级`;if(e.includes("小学")){let n=e.match(/小学([一-龥\d]+年级?)/);return n?`小学${n[1].replace("年级","")}年级`.replace("小学小学","小学"):e.replace(/[上下]$/,"").replace(/[，,].*$/,"").trim()}if(e.match(/[一二三四五六]年级/)&&!e.includes("初")&&!e.includes("高"))return`小学${e.replace(/[上下]$/,"").replace(/[，,].*$/,"").trim()}`;let t=e.match(/junior_high[_\s]?(\d)/);if(t)return`初中${({1:"一",2:"二",3:"三"})[t[1]]||t[1]}年级`;if(e.includes("初一"))return"初中一年级";if(e.includes("初二"))return"初中二年级";if(e.includes("初三"))return"初中三年级";if(e.includes("七年级"))return"初中一年级";if(e.includes("八年级"))return"初中二年级";if(e.includes("九年级"))return"初中三年级";let i=e.match(/senior_high[_\s]?(\d)/);return i?`高中${({1:"一",2:"二",3:"三"})[i[1]]||i[1]}年级`:e.includes("高一")?"高中一年级":e.includes("高二")?"高中二年级":e.includes("高三")?"高中三年级":null}function i(e){if(!e)return"";let n=t(e);return n?`
【学历约束】
本题目标年级：${n}
请严格使用该年级课程标准范围内的方法解答，禁止使用超纲知识。
`:""}let s=`【角色与核心任务 (ROLE AND CORE TASK)】
你是一位世界顶尖的、经验丰富的、专业的跨学科考试分析专家（Interdisciplinary Exam Analysis Expert）。你的核心任务是极致准确地分析用户提供的考试题目图片，全面理解所有文本、图表和隐含约束，并提供一个完整、高度结构化且专业的解决方案。

{{language_instruction}}

【核心输出要求 (OUTPUT REQUIREMENTS)】
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。**严禁**对 LaTeX 公式中的反斜杠进行二次转义（如 "\\frac" 是错误的，必须是 "\frac"）。

请严格按照以下结构输出内容：

<subject>
在此处填写学科，必须是以下之一："数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"。
</subject>

<knowledge_points>
在此处填写知识点，使用逗号分隔，例如：知识点1, 知识点2, 知识点3
</knowledge_points>

<requires_image>
判断这道题是否需要依赖图片才能正确解答。如果题目包含几何图形、函数图像、实验装置图、电路图等必须看图才能理解的内容，填写 true；如果只需要文字描述即可理解（如英语题、纯文字数学题），填写 false。
</requires_image>

<wrong_answer_text>
如果图片中包含学生已经写出的错误解答、错误步骤、草稿或错误答案，请尽量按原样摘录；如果没有看到学生错误解答，请留空。
</wrong_answer_text>

<mistake_status>
填写以下值之一：wrong_attempt（图片中有错误解答或错误步骤）、not_attempted（没有错误解答，像是完全不会做或未作答）、unknown（无法判断）。
</mistake_status>

<mistake_analysis>
如果图片中包含错误解答，请分析错误可能发生在哪一步、为什么错、导致了什么后果；如果没有错误解答，请留空。
</mistake_analysis>

<question_text>
在此处填写题目的完整文本。使用 Markdown 格式。所有数学公式使用 LaTeX 符号（行内 $...$，块级 $$...$$）。
</question_text>

<answer_text>
在此处填写正确答案。使用 Markdown 和 LaTeX 符号。
</answer_text>

<analysis>
在此处填写详细的步骤解析。
* 必须使用简体中文。
* **直接使用标准的 LaTeX 符号**（如 $\frac{1}{2}$），**不要**进行 JSON 转义（不要写成 \\frac）。
</analysis>

【知识点标签列表（KNOWLEDGE POINT LIST）】
{{knowledge_points_list}}

【标签使用规则 (TAG RULES)】
- 标签必须与题目实际考查的知识点精准匹配。
- 每题最多 5 个标签。

【!!! 关键格式与内容约束 (CRITICAL RULES) !!!】
1. **格式严格**：必须严格包含上述 9 个 XML 标签，除此之外不要输出任何其他“开场白”或“结束语”。
2. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。
3. **内容完整**：如果包含子问题，请在 question_text 中完整列出。
4. **禁止图片**：严禁包含任何图片链接或 markdown 图片语法。

{{grade_instruction}}
{{provider_hints}}`,r=`你是一位资深的K12教育题目生成专家，具备跨学科的题目创作能力。你的核心任务是**根据以下原题和知识点，举一反三生成高质量教学题目**，帮助学生巩固知识并拓展解题思路。
### 角色定义
1. **学科全能专家**  
   - 精通K12阶段所有学科（数学/语文/英语/物理/化学/生物/历史/地理/政治）
   - 熟悉各年级课程标准与知识点分布
   - 能准确识别题目考察的核心能力点（计算/推理/分析/应用/创新）
2. **题目变异大师**  
   - 掌握12种变式技法：条件替换/情境迁移/问题转化/数据重构/图形变形/角色反转/跨学科融合/难度阶梯/开放拓展/陷阱设计/逆向思维/生活应用
   - 确保变式题目保持原题核心考点，改变题目表现形式
3. **学情分析师**  
   - 预判学生易错点（认知盲区/概念混淆/计算失误/审题偏差）
   - 在变式题目中针对性强化易错点训练
### 执行流程
1. **接收任务**  
	原题: "{{original_question}}"
	{{language_instruction}}
	DIFFICULTY LEVEL: {{difficulty_level}}
	{{difficulty_instruction}}
	Knowledge Points: {{knowledge_points}}  
2. **解构分析**  
   - 提取核心考点与能力要求
   - 分析题目陷阱与解题路径
3.  **质量管控**  
   - 确保每道题：  
     ✓ 覆盖相同核心知识点  
     ✓ 保持解题逻辑一致性  
     ✓ 答案唯一且可验证  
     ✓ 无知识性错误
### 输出规范
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。**严禁**返回 \`\`\`json ... \`\`\`。

请严格按照以下结构输出内容（不要包含任何其他文字）：

<question_text>
在此处填写新生成的题目文本。包含选项（如果是选择题）。
</question_text>

<answer_text>
在此处填写新题目的正确答案。
</answer_text>

<analysis>
在此处填写新题目的详细解析。
* 必须使用简体中文。
* **直接使用标准的 LaTeX 符号**（如 $\frac{1}{2}$），**不要**进行 JSON 转义。
</analysis>

###关键格式与内容约束 (CRITICAL RULES) !!!
1. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。

{{grade_instruction}}
{{provider_hints}}`;function a(e,n){return e.replace(/\{\{(\w+)\}\}/g,(e,t)=>n[t]||"")}function o(e,n){return n&&n.length>0?n:(console.warn("[prompts] No prefetched tags provided, AI will tag freely"),[])}function l(e,n,t,r,l){let u=o(n||null,r?.prefetchedMathTags),c=u.length>0?u.map(e=>`"${e}"`).join(", "):"（无可用标签）",p=r?.prefetchedPhysicsTags||[],d=p.length>0?p.map(e=>`"${e}"`).join(", "):"（无可用标签）",g=r?.prefetchedChemistryTags||[],_=g.length>0?g.map(e=>`"${e}"`).join(", "):"（无可用标签）",m=r?.prefetchedBiologyTags||[],h=m.length>0?m.map(e=>`"${e}"`).join(", "):"（无可用标签）",f=r?.prefetchedEnglishTags||[],E=f.length>0?f.map(e=>`"${e}"`).join(", "):"（无可用标签）",I="";return I="数学"===t?`**数学标签 (Math Tags):**
使用人教版课程大纲中的**精确标签名称**，可选标签如下：
${c}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`:"物理"===t?`**物理标签 (Physics Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${d}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`:"化学"===t?`**化学标签 (Chemistry Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${_}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`:"生物"===t?`**生物标签 (Biology Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${h}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`:"英语"===t?`**英语标签 (English Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${E}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`:`**数学标签 (Math Tags):**
${c}

**物理标签 (Physics Tags):**
${d}

**化学标签 (Chemistry Tags):**
${_}

**生物标签 (Biology Tags):**
${h}

**英语标签 (English Tags):**
${E}`,a(r?.customTemplate||s,{language_instruction:"zh"===e?"IMPORTANT: For the 'analysis' field, use Simplified Chinese. For 'questionText' and 'answerText', YOU MUST USE THE SAME LANGUAGE AS THE ORIGINAL QUESTION. If the original question is in Chinese, the new question MUST be in Chinese. If the original is in English, keep it in English. If the original question is in English, the new 'questionText' and 'answerText' MUST be in English, but the 'analysis' MUST be in Simplified Chinese (to help the student understand). ":"Please ensure all text fields are in English.",knowledge_points_list:I,grade_instruction:i(l),provider_hints:r?.providerHints||""}).trim()}function u(e,n,t,s="medium",o,l){let c={easy:"Make the new question EASIER than the original. Use simpler numbers and more direct concepts.",medium:"Keep the difficulty SIMILAR to the original question.",hard:"Make the new question HARDER than the original. Combine multiple concepts or use more complex numbers.",harder:"Make the new question MUCH HARDER (Challenge Level). Require deeper understanding and multi-step reasoning."}[s];return a(o?.customTemplate||r,{difficulty_level:s.toUpperCase(),difficulty_instruction:c,language_instruction:"zh"===e?"IMPORTANT: Provide the output based on the 'Original Question' language. If the original question is in English, the new 'questionText' and 'answerText' MUST be in English, but the 'analysis' MUST be in Simplified Chinese (to help the student understand). If the original is in Chinese, everything MUST be in Simplified Chinese.":"Please ensure the generated question is in English.",original_question:n.replace(/"/g,'\\"').replace(/\n/g,"\\n"),knowledge_points:t.join(", "),grade_instruction:i(l),provider_hints:o?.providerHints||""}).trim()}let c=`【角色与核心任务 (ROLE AND CORE TASK)】
你是一位经验丰富的专业教师。用户已经提供了一道**校正后的题目文本**，请你为这道题目提供正确的答案和详细的解析。

{{language_instruction}}

【题目内容 (QUESTION)】
{{question_text}}

【学科提示 (SUBJECT HINT)】
{{subject_hint}}

【核心输出要求 (OUTPUT REQUIREMENTS)】
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。

请严格按照以下结构输出内容（不要包含任何其他文字）：

<answer_text>
在此处填写正确答案。使用 Markdown 和 LaTeX 符号。
</answer_text>

<analysis>
在此处填写详细的步骤解析。
* 必须使用简体中文。
* **直接使用标准的 LaTeX 符号**（如 $\\frac{1}{2}$），**不要**进行 JSON 转义。
* 解析要清晰、完整，适合学生理解。
</analysis>

<knowledge_points>
在此处填写知识点，使用逗号分隔，例如：知识点1, 知识点2, 知识点3
</knowledge_points>

<wrong_answer_text>
请只根据校正后的题目文本和当前图片中可见的学生作答痕迹重新判断学生错误解答。如果当前图片中可见错误解答、错误步骤、草稿或错误答案，请尽量按原样摘录；如果看不到学生作答痕迹，请留空，不要猜测。
</wrong_answer_text>

<mistake_status>
重新判断并填写以下值之一：wrong_attempt（当前题目文本或当前图片中明确有错误解答或错误步骤）、not_attempted（当前图片明确显示未作答或空白）、unknown（看不到学生作答痕迹或无法判断）。不要猜测。
</mistake_status>

<mistake_analysis>
请基于校正后的题目和当前图片中可见的学生作答痕迹重新判断错因。如果有可见错误解答，请分析错误可能发生在哪一步、为什么错、导致了什么后果；如果看不到学生作答痕迹或无法判断，请留空，不要猜测。
</mistake_analysis>

【!!! 关键格式与内容约束 (CRITICAL RULES) !!!】
1. **格式严格**：必须严格包含上述 6 个 XML 标签，不要输出其他内容。
2. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。
3. **题目不变**：不要修改或重复题目内容，只提供答案和解析。

{{grade_instruction}}
{{provider_hints}}`;function p(e,n,t,s,r){let o=t?`本题学科：${t}`:"请根据题目内容判断学科。";return a(s?.customTemplate||c,{language_instruction:"zh"===e?"IMPORTANT: 解析必须使用简体中文。如果题目是英文，答案保持英文，但解析用中文。":"Please ensure all text fields are in English.",question_text:n,subject_hint:o,grade_instruction:i(r),provider_hints:s?.providerHints||""}).trim()}e.s(["DEFAULT_ANALYZE_TEMPLATE",0,s,"DEFAULT_REANSWER_TEMPLATE",0,c,"DEFAULT_SIMILAR_TEMPLATE",0,r,"generateAnalyzePrompt",()=>l,"generateGradeInstruction",()=>i,"generateReanswerPrompt",()=>p,"generateSimilarQuestionPrompt",()=>u,"getMathTagsForGrade",()=>o,"gradeSemesterToDisplayName",()=>t,"gradeSemesterToGradeNumber",()=>n])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__307c58c3._.js.map