import { z } from "zod";
import { parseJSON } from "../ai-dialogue/protocol";
import { AIError } from "../ai/transport";
import { ConstructionSchema, compileConstruction, type ConstructionPlan } from "./construction";

const UnsupportedSchema = z.object({unsupported: z.literal(true)}).strict();
export function parseConstruction(raw: string) {
    return validateParsedConstruction(parseJSON(raw, z.unknown()));
}
function validateParsedConstruction(value: unknown) {
    if (UnsupportedSchema.safeParse(value).success) throw new AIError("AI_DRAWING_UNSUPPORTED", false, 0, "DRAWING_UNSUPPORTED");
    const parsed = ConstructionSchema.safeParse(value);
    if (!parsed.success) {
        // Fixed categories only: never persist rejected values, field names or upstream text.
        const issues = parsed.error.issues;
        const diagnostic = issues.some(i=>i.code === "unrecognized_keys") ? "DRAWING_SCHEMA_FIELDS" :
            issues.some(i=>i.code === "too_big" || i.code === "too_small") ? "DRAWING_SCHEMA_LIMIT" :
            issues.some(i=>i.path[0] === "points") ? "DRAWING_SCHEMA_POINT" :
            issues.some(i=>i.path[0] === "steps" && i.path[2] === "operation") ? "DRAWING_SCHEMA_OPERATION" : "DRAWING_SCHEMA_FIELDS";
        throw new AIError("AI_RESPONSE_ERROR", true, 0, diagnostic);
    }
    try { compileConstruction(parsed.data); }
    catch { throw new AIError("AI_DRAWING_INVALID", true, 0, "DRAWING_INVALID"); }
    return parsed.data;
}


/** A persisted first-stage result contains no auxiliary operations. */
export function validateConstructionBase(raw: ConstructionPlan): ConstructionPlan {
    const base = ConstructionSchema.parse(raw);
    if (base.steps.length) throw new AIError("AI_DRAWING_INVALID", false, 0, "DRAWING_INVALID");
    compileConstruction(base);
    return base;
}
export function parseConstructionBase(raw: string, questionText?: string): ConstructionPlan {
    let value = parseJSON(raw, z.unknown());
    // Current editor text is authoritative. Discard an unnecessary model copy
    // before schema validation, without masking unsupported or geometry errors.
    if (questionText?.trim() && value && typeof value === 'object' && !Array.isArray(value) && !UnsupportedSchema.safeParse(value).success)
        value = {...value, sourceText: questionText};
    const plan = validateParsedConstruction(value);
    if (plan.steps.length) throw new AIError("AI_RESPONSE_ERROR", true, 0, "DRAWING_SCHEMA_FIELDS");
    return plan;
}
const AuxiliarySchema = z.object({steps: ConstructionSchema.shape.steps.min(1)}).strict();
// Fixed categories only. Older models may still return just {unsupported:true}.
const AuxiliaryRefusalSchema = z.object({unsupported:z.literal(true),reason:z.enum([
    'missing_base_point','base_conflict','circle_intersection','unsupported_operation',
    'insufficient_information','no_auxiliary_needed','step_limit',
]).optional()}).strict();
const refusalDiagnostics = {
    missing_base_point:'DRAWING_MISSING_BASE_POINT',base_conflict:'DRAWING_BASE_CONFLICT',
    circle_intersection:'DRAWING_CIRCLE_INTERSECTION',unsupported_operation:'DRAWING_UNSUPPORTED_OPERATION',
    insufficient_information:'DRAWING_INSUFFICIENT_INFORMATION',no_auxiliary_needed:'DRAWING_NO_AUXILIARY_NEEDED',
    step_limit:'DRAWING_STEP_LIMIT',
} as const;
export function parseConstructionSteps(raw: string, lockedBase: ConstructionPlan): ConstructionPlan {
    const value = parseJSON(raw, z.unknown());
    // A completed refusal is this model's judgment, not proof that every solver
    // cannot express the construction. Keep the same frozen base and let the
    // bounded text-model chain try its next candidate; never invent operations.
    const refusal = AuxiliaryRefusalSchema.safeParse(value);
    if (refusal.success) throw new AIError("AI_DRAWING_UNSUPPORTED", true, 0,
        refusal.data.reason ? refusalDiagnostics[refusal.data.reason] : "DRAWING_UNSUPPORTED");
    const parsed = AuxiliarySchema.safeParse(value);
    if (!parsed.success) throw new AIError("AI_RESPONSE_ERROR", true, 0, "DRAWING_SCHEMA_FIELDS");
    // Never accept model-returned base coordinates, even if a full plan looks valid.
    // Parsing clones the stored snapshot, so no retry can mutate the caller's base.
    const plan = {...validateConstructionBase(lockedBase), steps: parsed.data.steps};
    try { compileConstruction(plan); }
    catch { throw new AIError("AI_DRAWING_INVALID", true, 0, "DRAWING_INVALID"); }
    return plan;
}
