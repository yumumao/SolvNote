/**
 * A compact protocol for the one expensive pixel re-read.  Full transcription
 * is intentionally not requested here: asking a vision model to rewrite the
 * whole transcript makes it much more likely to emit an invalid angle object.
 */
export const GEOMETRY_CHECK_PROMPT = String.raw`你只负责关键编号角的像素核对，不转录、不解题、不输出答案。
输入图像顺序固定：第1张是完整原图；后续图片是同一原图的局部裁剪，不是不同题目。只能依据图中可见的点名、角弧和两条射线核对，不能根据“哪种解法更好算”反推角名。
请求数据里的geometryHypotheses是上一轮识图的候选，不是事实；请重新观察完整原图和局部图。先定位编号标签，再找该角的顶点，最后沿角弧两端追踪实际经过的两条射线；区分同一顶点处相邻小角与组合大角。

只返回下面这个严格JSON对象，不要代码围栏、解释文字、Markdown或其他字段：
{"angles":[{"label":"1","vertex":"A","arms":["B","C"]}],"geometryUncertainties":[]}
协议要求：
- angles只返回labelsToLocate中的编号角；label必须逐字沿用labelsToLocate中的标签，不得改成角名、补“∠”或另造编号。
- 每个已核对角必须有真实可见的vertex和恰好两个不同的arms点名；arms填写两条射线的末端点名，不是整条射线。例如顶点B、射线BA与BC必须写arms:["A","C"]，不能写["BA","BC"]。arms不含vertex。点名不确定时不要猜，改在geometryUncertainties中写明具体编号和不确定的顶点/射线。
- geometryUncertainties必须始终存在且是数组，最多8项；即使一个角也无法确认，也必须返回{"angles":[],"geometryUncertainties":["编号角1的顶点或射线无法确认"]}，不能省略字段、返回null或改回完整转录协议。全部编号角的顶点、两条射线和角弧对应都已核清时必须返回[]。
- geometryUncertainties只能记录labelsToLocate中仍未核定的角标证据，不要把普通题干疑问、草稿不清、可选裁剪框、题目缺字或需要数学推导放进来。
- 不要返回text、facts、regions、uncertainties、missingInformation或geometry包装字段；服务端会保留原转录和原图坐标。`;
