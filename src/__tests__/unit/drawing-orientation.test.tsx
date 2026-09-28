import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ConstructionDiagram } from "@/components/construction-diagram";
import { compileConstruction, CONSTRUCTION_PROMPT, constructionExamples, type ConstructionPlan } from "@/lib/ai-drawing/construction";

// Deliberately not normalized to a horizontal AB: the supplied source has A above B.
const plan: ConstructionPlan = {
    title: "Synthetic rotated copy",
    points: [{ id: "A", x: 2, y: 5 }, { id: "B", x: 2, y: 1 }, { id: "C", x: 5, y: 1 }],
    segments: [["A", "B"], ["B", "C"], ["C", "A"]],
    circles: [{ center: "B", through: "C" }],
    arcs: [{ center: "B", start: "C", end: "A", direction: "ccw" }],
    steps: [
        { description: "Copy B around A", operation: { kind: "rotate", id: "B1", point: "B", center: "A", degrees: 90 } },
        { description: "Copy C around A", operation: { kind: "rotate", id: "C1", point: "C", center: "A", degrees: 90 } },
        { description: "Join A to B1", operation: { kind: "segment", a: "A", b: "B1" } },
        { description: "Join B1 to C1", operation: { kind: "segment", a: "B1", b: "C1" } },
        { description: "Join C1 to A", operation: { kind: "segment", a: "C1", b: "A" } },
    ],
};
// Use equal radii for the independent circle/arc invariant.
const withRounds: ConstructionPlan = { ...plan, points: plan.points.map(p => p.id === "C" ? { ...p, x: 6 } : p) };

describe("original diagram orientation and auxiliary copies", () => {
    it.each([false, true])("keeps foundation geometry immutable (sector=%s)", (sector) => {
        const withRounds = { ...plan, points: plan.points.map(p => p.id === "C" ? { ...p, x: 6 } : p), arcs: plan.arcs!.map(a => ({ ...a, sector })) };
        const before = structuredClone(withRounds);
        const result = compileConstruction(withRounds);
        const withoutRotation = compileConstruction({ ...withRounds, steps: [{ description: "Join", operation: { kind: "segment", a: "A", b: "C" } }] });
        expect(withRounds).toEqual(before);
        expect(result.base).toEqual(withoutRotation.base);
        expect(result.base.join("\n")).not.toContain("Rotate(");
        expect(result.geometry.points.filter(p => p.step === 0)).toEqual(before.points.map(p => ({ ...p, step: 0 })));
        expect(result.geometry.basePoints).toEqual(before.points.map(p => ({ ...p, step: 0 })));
        expect(result.geometry.baseSegments).toEqual([
            ...before.segments.map(([a, b]) => ({ a, b, step: 0 })),
            ...(sector ? [{ a: "B", b: "C", step: 0 }, { a: "B", b: "A", step: 0 }] : []),
        ]);
        expect(result.geometry.derivedPoints.map(p => p.id)).toEqual(["B1", "C1"]);
        expect(result.geometry.derivedSegments).toHaveLength(3);
        expect(result.geometry.points).toEqual([...result.geometry.basePoints, ...result.geometry.derivedPoints]);
        expect(result.geometry.segments).toEqual([...result.geometry.baseSegments, ...result.geometry.derivedSegments]);
        expect(result.geometry.circles).toEqual(withoutRotation.geometry.circles);
        expect(result.geometry.arcs).toEqual(withoutRotation.geometry.arcs);
        expect(result.geometry.points.find(p => p.id === "B1")?.x).toBeCloseTo(6);
        expect(result.geometry.points.find(p => p.id === "B1")?.y).toBeCloseTo(5);
        expect(result.steps[0].commands[0]).toBe("B1=Rotate(B,90°,A)");
        expect(result.steps[1].commands[0]).toBe("C1=Rotate(C,90°,A)");
    });

    it("rejects using a rotation to overwrite an original point", () => {
        expect(() => compileConstruction({ ...withRounds, steps: [{ description: "Overwrite B", operation: { kind: "rotate", id: "B", point: "B", center: "A", degrees: 90 } }] })).toThrow("INVALID_CONSTRUCTION");
    });

    it("keeps base SVG pixels and orientation identical through forward and backward steps", async () => {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        const host = document.createElement("div"), root = createRoot(host);
        const geometry = compileConstruction(withRounds).geometry;
        const base = () => [...host.querySelectorAll('line[data-base-segment], g[data-base-point], circle[data-base-circle], path[data-base-arc]')].map(el => el.outerHTML);
        try {
            await act(async () => root.render(<ConstructionDiagram geometry={geometry} visible={0} title={plan.title} />));
            const original = base();
            expect(original).toHaveLength(8);
            expect(host.querySelectorAll('[data-base-point]')).toHaveLength(3);
            expect(host.querySelectorAll('[data-base-segment]')).toHaveLength(3);
            expect(host.querySelectorAll('[data-aux-point], [data-aux-segment]')).toHaveLength(0);
            const ab = host.querySelector("line")!;
            expect(ab.getAttribute("x1")).toBe(ab.getAttribute("x2"));
            expect(Number(ab.getAttribute("y1"))).toBeLessThan(Number(ab.getAttribute("y2")));
            for (const visible of [1, 3, 5, 2, 0]) {
                await act(async () => root.render(<ConstructionDiagram geometry={geometry} visible={visible} title={plan.title} />));
                expect(base()).toEqual(original);
                expect(host.querySelectorAll('[data-aux-point]')).toHaveLength(Math.min(visible, 2));
                expect(host.querySelectorAll('[data-aux-segment]')).toHaveLength(Math.max(0, visible - 2));
                expect(host.querySelectorAll('line[stroke="#dc2626"]')).toHaveLength(Math.max(0, visible - 2));
            }
        } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
    });

    it("explicitly separates source orientation from solution rotations in generation instructions", () => {
        expect(CONSTRUCTION_PROMPT).toContain("不得整体旋转、镜像或翻转原题底图");
        expect(CONSTRUCTION_PROMPT).toContain("x向右、y向上");
        expect(CONSTRUCTION_PROMPT).toContain("原图只用于布局对照，不从外观推断");
        expect(CONSTRUCTION_PROMPT).toContain("旋转后的副本");
    });

    it("includes a compilable non-horizontal rotation example without relabelling the base", () => {
        const examples = constructionExamples;
        const rotation = examples.find(p => p.steps.some(s => s.operation.kind === "rotate"))!;
        expect(rotation.points.find(p => p.id === "A")?.x).toBe(rotation.points.find(p => p.id === "B")?.x);
        expect(rotation.points.find(p => p.id === "A")!.y).toBeLessThan(rotation.points.find(p => p.id === "B")!.y);
        const result = compileConstruction(rotation);
        expect(result.steps.filter(s => s.commands[0].includes("Rotate("))).toHaveLength(2);
        expect(result.geometry.segments.filter(s => s.step === 0)).toHaveLength(3);
        expect(result.geometry.segments.filter(s => s.step > 0)).toHaveLength(3);
    });
});
