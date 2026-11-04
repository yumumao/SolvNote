import { z } from "zod";
import { prisma } from "../prisma";
import { requireTxAiActor } from "./account";
import { loadEffectiveAIConfig, loadEffectiveAIConfigInTx } from "./effective-config";
import { conflict } from "./errors";
import { ModelOrderSchema, validateOrder } from "./model-order";

const version=z.number().int().nonnegative();
const patch=z.object({revisions:z.object({site:version,policy:version,private:version,order:version}).strict(),chains:ModelOrderSchema}).strict();

export async function saveUserModelOrder(userId:string, raw:unknown, sessionVersion:number) {
    const data=patch.parse(raw);
    // Bootstrap only outside the mutation transaction, then recheck everything inside it.
    await loadEffectiveAIConfig(userId);
    await prisma.$transaction(async tx => {
        await requireTxAiActor(tx,userId,sessionVersion);
        const effective=await loadEffectiveAIConfigInTx(tx,userId);
        for(const key of ["site","policy","private","order"] as const) {
            if(data.revisions[key]!==effective.revisions[key])conflict();
        }
        validateOrder(data.chains,effective.config.chains);
        const saved=await tx.user.updateMany({where:{id:userId,aiOrderRevision:data.revisions.order},data:{aiModelOrder:JSON.stringify(data.chains),aiOrderRevision:{increment:1}}});
        if(saved.count!==1)conflict();
    });
}
