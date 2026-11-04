import { describe, expect, it } from "vitest";
import { applyOrder, replaceSiteOrder, validateOrder } from "@/lib/ai-access/model-order";

describe("model ordering contains references only", () => {
    it("orders built-in-only and mixed chains independently, appending new usable models", () => {
        expect(applyOrder({text:["a","b","private/p"],vision:["a","b"]}, {text:["private/p","b","a"],vision:["b","a"]}))
            .toEqual({text:["private/p","b","a"],vision:["b","a"]});
        expect(applyOrder({text:["a","new"],vision:[]}, {text:["revoked","a"],vision:["a"]}))
            .toEqual({text:["a","new"],vision:[]});
    });
    it("requires exact permutations, rejecting capability crossover and ungranted references", () => {
        const available={text:["a","b"],vision:["a"]};
        expect(()=>validateOrder({text:["b","a"],vision:["a"]},available)).not.toThrow();
        for(const chains of [{text:["a"],vision:["a"]},{text:["a","a"],vision:["a"]},{text:["a","unknown"],vision:["a"]},{text:["a","b"],vision:["b"]}]) {
            expect(()=>validateOrder(chains,available)).toThrow();
        }
    });
    it("admin changes built-in relative order while retaining personal slots", () => {
        expect(replaceSiteOrder({text:["a","private/p","b","private/q","old"],vision:["a","private/p","b"]},{text:["b","a","new"],vision:["b","a"]}))
            .toEqual({text:["b","private/p","a","private/q","new"],vision:["b","private/p","a"]});
    });
});
