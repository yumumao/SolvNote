import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { getAppConfig } from "../config";
import { migrateLegacy } from "./legacy";
import { parseConfig, type PortableConfig } from "./schema";
import { protect, unprotect, masterKey } from "./vault";

/** No-argument callers keep lazy migration; previews can opt into a read-only snapshot. */
export async function loadAIConfig(options: { persist?: boolean } = {}) {
    let row = await prisma.aiConfiguration.findUnique({
        where: { id: "site" },
    });
    if (!row) {
        const config = migrateLegacy(getAppConfig());
        // Revision zero means no row exists, never a persisted revision. This
        // branch must not create either a configuration row or a vault key.
        if (options.persist === false) return { config, revision: 0 };
        masterKey(true);
        row = await prisma.aiConfiguration.upsert({
            where: { id: "site" },
            create: { id: "site", payload: protect(config) },
            update: {},
        });
    }
    return {
        config: parseConfig(unprotect(row.payload)),
        revision: row.revision,
    };
}

export async function saveAIConfig(
    config: PortableConfig,
    expectedRevision: number,
) {
    // Never generate a missing key here: first apply must use its preview's key.
    const payload = protect(parseConfig(config));
    if (expectedRevision === 0) {
        try {
            // A unique-key INSERT is the first-write CAS. Upsert would silently
            // accept or overwrite a concurrent first apply / legacy migration.
            await prisma.aiConfiguration.create({
                data: { id: "site", revision: 1, payload },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                throw Error("CONFIG_CONFLICT");
            }
            throw error;
        }
        return 1;
    }
    const result = await prisma.aiConfiguration.updateMany({
        where: { id: "site", revision: expectedRevision },
        data: { payload, revision: { increment: 1 } },
    });
    if (result.count !== 1) throw Error("CONFIG_CONFLICT");
    return expectedRevision + 1;
}
