import type {ConstructionPlan} from "./construction";

// Compare the actual drawing inputs, not a changed title or explanatory note.
// Array order and segment endpoint order are not meaningful drawing changes.
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]),
    );
    return value;
}
function signature(plan: ConstructionPlan): string {
    const sorted = (items: unknown[]) => items.map(item => JSON.stringify(canonical(item))).sort();
    return JSON.stringify({
        points: sorted(plan.points),
        segments: sorted(plan.segments.map(segment => [...segment].sort())),
        circles: sorted(plan.circles ?? []),
        arcs: sorted(plan.arcs ?? []),
        annotations: sorted(plan.annotations ?? []),
    });
}
export function sameBaseDrawing(previous: ConstructionPlan, next: ConstructionPlan): boolean {
    return signature(previous) === signature(next);
}