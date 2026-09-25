import { RECOGNIZE_PROMPT } from "./protocol";
export const GEOMETRY_CHECK_PROMPT=RECOGNIZE_PROMPT+`\n本次是关键角标像素核对，不是解题。第一张为完整原图，其余为从同一原图裁剪的局部，不是不同题目。不依赖前一模型的角名猜测。先看顶点，再沿红弧/角弧两端找到实际射线，区别相邻小角和组合大角。完整返回原题转录与geometry，坐标仍相对第一张整图。不能确定时说明具体哪个编号角及哪条边；不得凭解答是否好算来选择角。`;
