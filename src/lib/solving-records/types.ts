export type RecordStatus = "processing" | "completed" | "awaiting" | "failed" | "cancelled";
export type SolvingRecord = {key:string; id:string; kind:"conversation"|"analyze"|"reanswer"; title:string; state:string; status:RecordStatus; createdAt:string; updatedAt:string; roundsUsed?:number};
export type RecordPage = {records:SolvingRecord[]; nextCursor:string|null};
export type SolvingStats = {total:number; completed:number; awaiting:number; processing:number; failed:number; cancelled:number; aiCalls:number; months:{month:string;count:number}[]};
export const statusLabels:Record<RecordStatus,string>={processing:"处理中",completed:"已完成",awaiting:"待补充",failed:"未完成／需核查",cancelled:"已取消"};
export const kindLabels={conversation:"同题会话",analyze:"直接解题",reanswer:"重新解答"};
export const stateGroups:Record<RecordStatus,string[]>={processing:["active","pending","running","cancelling"],completed:["answered","success"],awaiting:["awaiting_user"],failed:["failed","unknown"],cancelled:["cancelled"]};
export function recordStatus(state:string):RecordStatus {
    return (Object.keys(stateGroups) as RecordStatus[]).find(k=>stateGroups[k].includes(state)) || "failed";
}
