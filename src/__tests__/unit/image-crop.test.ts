import { describe, expect, it } from "vitest";
import type { PercentCrop } from "react-image-crop";
import { sourceCropRect } from "@/lib/image-crop";
const initial: PercentCrop = { unit: "%", x: 10, y: 25, width: 80, height: 50 };
describe("source crop rectangle", () => {
    it("maps percentages to natural pixels", () => {
        expect(sourceCropRect(initial, 1600, 1200)).toEqual({ x: 160, y: 300, width: 1280, height: 600 });
    });
    it("rounds edges consistently instead of truncating canvas dimensions", () => {
        expect(sourceCropRect(initial, 1003, 701)).toEqual({ x: 100, y: 175, width: 803, height: 351 });
    });
    it("clamps a partially out-of-bounds selection", () => {
        expect(sourceCropRect({ ...initial, x: -10, y: 90, width: 120, height: 30 }, 101, 71)).toEqual({ x: 0, y: 64, width: 101, height: 7 });
    });
    it("supports the complete source and one-pixel images", () => {
        expect(sourceCropRect({ unit: "%", x: 0, y: 0, width: 100, height: 100 }, 1600, 1200)).toEqual({ x: 0, y: 0, width: 1600, height: 1200 });
        expect(sourceCropRect(initial, 1, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    });
    it("keeps a subpixel selection at the far edge inside the image", () => {
        expect(sourceCropRect({ unit: "%", x: 99.99, y: 99.99, width: 0.01, height: 0.01 }, 100, 100)).toEqual({ x: 99, y: 99, width: 1, height: 1 });
    });
    it.each([
        { x: NaN }, { y: Infinity }, { width: -1 }, { height: 0 }, { x: 101 }, { y: -200 },
    ])("rejects invalid or completely out-of-image selections: %o", change => {
        expect(sourceCropRect({ ...initial, ...change }, 100, 100)).toBeNull();
    });
    it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid source size %s", size => {
        expect(sourceCropRect(initial, size, 100)).toBeNull();
        expect(sourceCropRect(initial, 100, size)).toBeNull();
    });
});
