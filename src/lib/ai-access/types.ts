import type { Prisma } from "@prisma/client";
export type AiAccessTx = Prisma.TransactionClient;
export type SiteModelSummary = { id: string; name: string; model: string; providerName: string; capabilities: ("text" | "vision")[] };
export type EffectiveRevision = { site: number; policy: number; private: number };
