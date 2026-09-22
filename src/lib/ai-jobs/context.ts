import type { PortableConfig } from "../ai-config/schema";
import { AsyncLocalStorage } from "node:async_hooks";
export type AIRun = {
    config?: PortableConfig;
    jobId?: string;
    leaseOwner?: string;
    signal: AbortSignal;
    deadline: number;
    attempts: number;
    maxAttempts: number;
    excludeModel?: string;
    lastModel?: string;
};
export const aiRun = new AsyncLocalStorage<AIRun>();
export const ATTEMPT_MS = 180000;
export const TOTAL_MS = 600000;
