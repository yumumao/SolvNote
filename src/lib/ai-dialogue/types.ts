import type { AIDiagnostic, AITransportDiagnostics } from "../ai/diagnostics";
import type { JobInput } from "../ai-jobs/schema";
import type { ParsedQuestion } from "../ai/types";
import type { GeometryEvidence } from "./geometry-schema";
export type Transcript = { geometry?:GeometryEvidence; geometryUncertainties?: string[]; text: string; facts: { detail: string; source?: "text" | "image" }[]; uncertainties: string[]; missingInformation: string[] };
export type DialogueMessage = { id: string; kind: "question" | "clarification" | "answer" | "notice"; text: string; at: string; round: number };
export type DialoguePayload = {
    input: JobInput;
    messages: DialogueMessage[];
    transcript?: Transcript;
    geometryCheckStarted?: boolean;
    geometryChecked?: boolean;
    userCorrectedTranscript?: boolean;
    /** Human supplements tied to this transcription; cleared when its source is replaced. */
    transcriptClarifications?: string[];
    solverId?: string;
    questions: string[];
    rereads: number;
    reviewDone?: boolean;
    result?: ParsedQuestion;
};
export type StepMetadata = { transport?: AITransportDiagnostics; diagnostic?: AIDiagnostic; round?: number; stage: string; modelName: string; model: string; providerName: string; withImage: boolean; detailImageCount?:number; questions: string[] };
export type ProcessStep = Partial<StepMetadata> & { id?: string; modelId: string; state: string; errorCode?: string | null; startedAt: string | Date; finishedAt: string | Date | null; round?: number };
export type DialogueView = {
    id: string; state: string; revision: number; roundsUsed: number; roundLimit: number; roundOpen: boolean;
    roundAttempts: number; attemptLimit: number; roundElapsedMs: number; timeLimitMs: number;
    isAdmin: boolean; activeJobId: string | null; errorCode?: string | null;
    transcript?: Transcript; userCorrectedTranscript?: boolean;
    /** Human supplements tied to this transcription; cleared when its source is replaced. */
    transcriptClarifications?: string[]; geometryChecked?: boolean;
    input: JobInput; messages: DialogueMessage[]; questions: string[]; result?: ParsedQuestion;
    steps: ProcessStep[]; updatedAt: string | Date;
};
export const DEFAULT_ATTEMPTS = 6;
export const DEFAULT_ACTIVE_MS = 600000;
export const MAX_ROUNDS = 100;
export const MAX_ATTEMPTS = 18;
export const MAX_ACTIVE_MS = 1800000;
