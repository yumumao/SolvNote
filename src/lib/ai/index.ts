import type { AIService } from "./types";
import { ManagedAIService } from "./managed-service";
export * from "./types";
export function getAIService(): AIService {
    return new ManagedAIService();
}
