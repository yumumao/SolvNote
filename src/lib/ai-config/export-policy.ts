import "server-only";

/** Deployment-only capability. Never accept request, client or persisted-config overrides. */
export function isAiConfigExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.SOLVNOTE_ENABLE_AI_CONFIG_EXPORT ?? "").trim().toLowerCase() === "true";
}

export function assertAiConfigExportEnabled(env?: NodeJS.ProcessEnv): void {
    if (!isAiConfigExportEnabled(env)) throw new Error("AI_CONFIG_EXPORT_DISABLED");
}
