import Link from "next/link";
import { AIConversation } from "@/components/ai-conversation";
export default async function DialoguePage({params}:{params:Promise<{id:string}>}){
    const {id}=await params;
    return <main className="max-w-4xl mx-auto p-5 space-y-5"><Link href="/ai-tasks">返回我的AI任务</Link><h1 className="text-2xl font-bold">同题解题与问答</h1><AIConversation id={id}/></main>;
}
