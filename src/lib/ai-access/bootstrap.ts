import { prisma } from "../prisma";
import { loadAIConfig } from "../ai-config/store";
import { parseConfig } from "../ai-config/schema";
import { unprotect } from "../ai-config/vault";
/** Call OUTSIDE registration/user-create transactions. Idempotent; no AI/network calls.
 * Only the uninitialized upgrade policy is seeded; administrator choices remain authoritative.
 * An empty catalog is valid and stays uninitialized so its first future catalog can be seeded. */
export async function ensureInitialAiPolicy(): Promise<void> {
    await loadAIConfig();
    await prisma.$transaction(async tx => {
        const policy = await tx.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}});
        if (policy.initialized) return;
        const row = await tx.aiConfiguration.findUniqueOrThrow({where:{id:"site"}});
        const config = parseConfig(unprotect(row.payload));
        const rows = await tx.aiSiteModelAccess.findMany({where:{isAllowed:true}});
        const allowed = new Set(rows.map(m => m.modelId));
        const defaults = [...new Set([...config.chains.text,...config.chains.vision,...config.models.map(m => m.id)])].filter(id => allowed.has(id)).slice(0,3);
        if (!defaults.length) return;
        const changed = await tx.aiAccessPolicy.updateMany({where:{id:"site",initialized:false,revision:policy.revision},data:{initialized:true,revision:{increment:1}}});
        if (changed.count !== 1) return;
        await tx.aiSiteModelAccess.updateMany({data:{defaultRank:null}});
        for (const [i,modelId] of defaults.entries()) await tx.aiSiteModelAccess.update({where:{modelId},data:{defaultRank:i+1}});
    });
}
