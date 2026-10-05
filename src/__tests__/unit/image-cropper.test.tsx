import type { ComponentProps, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type ReactCrop from "react-image-crop";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ImageCropper } from "@/components/image-cropper";

const mocks = vi.hoisted(() => ({ crop: null as ComponentProps<typeof ReactCrop> | null }));
vi.mock("react-image-crop", () => ({
    default: (props: ComponentProps<typeof ReactCrop>) => {
        mocks.crop = props;
        return createElement("div", {}, props.children);
    },
}));
vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({ language: "zh", t: { common: { cropper: {}, confirm: "确认", cancel: "取消" } } }),
}));
vi.mock("@/components/ui/dialog", () => ({
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? children : null,
    ...Object.fromEntries(["DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"].map(k => [k,
        ({ children }: { children: ReactNode }) => createElement("div", {}, children),
    ])),
}));

let host: HTMLDivElement, root: Root, image: HTMLImageElement;
let draw: ReturnType<typeof vi.fn>;
let done: ReturnType<typeof vi.fn<(blob: Blob) => void>>;
let resize: ResizeObserverCallback;
const syntheticBlob = () => new Blob(["synthetic"], { type: "image/jpeg" });
async function render(src = "blob:first", open = true) {
    await act(async () => root.render(createElement(ImageCropper, { imageSrc: src, open, onClose: vi.fn(), onCropComplete: done })));
    image = host.querySelector("img")!;
}
async function load(w = 1600, h = 1200, dw = 800, dh = 600) {
    for (const [k, v] of Object.entries({ naturalWidth: w, naturalHeight: h, width: dw, height: dh, complete: true })) {
        Object.defineProperty(image, k, { value: v, configurable: true });
    }
    await act(async () => image.dispatchEvent(new Event("load")));
}
async function select() {
    await act(async () => mocks.crop!.onChange!(
        { unit: "px", x: 160, y: 120, width: 400, height: 300 },
        { unit: "%", x: 20, y: 20, width: 50, height: 50 },
    ));
}
function button(text = "确认") {
    return Array.from(host.querySelectorAll("button")).find(b => b.textContent === text)!;
}
async function confirm() { await act(async () => button().click()); }
beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    draw = vi.fn(); done = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(syntheticBlob()));
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe() { }
        disconnect() { }
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["uncropped"]) })));
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("crop preview and export use the same normalized source selection", () => {
    it("exports the visible initial selection without a pointer drag", async () => {
        await render(); await load(); await confirm();
        expect(draw).toHaveBeenCalledWith(image, 160, 300, 1280, 600, 0, 0, 1280, 600);
        expect(fetch).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledTimes(1);
    });
    it("does not reuse display pixels after desktop resize", async () => {
        await render(); await load(); await select();
        Object.defineProperty(image, "width", { value: 400, configurable: true });
        Object.defineProperty(image, "height", { value: 300, configurable: true });
        await confirm();
        expect(draw).toHaveBeenCalledWith(image, 320, 240, 800, 600, 0, 0, 800, 600);
    });
    it("uses natural dimensions rather than rounded CSS width/height", async () => {
        await render(); await load(1600, 1200, 734, 551); await select(); await confirm();
        expect(draw).toHaveBeenCalledWith(image, 320, 240, 800, 600, 0, 0, 800, 600);
    });
    it("resets the selection on a different image", async () => {
        await render(); await load(); await select(); await render("blob:second"); await load(700, 1400); await confirm();
        expect(draw).toHaveBeenCalledWith(image, 70, 350, 560, 700, 0, 0, 560, 700);
    });
    it("resets on close and reopen even with the same source", async () => {
        await render(); await load(); await select(); await render("blob:first", false); await render(); await load(); await confirm();
        expect(draw).toHaveBeenCalledWith(image, 160, 300, 1280, 600, 0, 0, 1280, 600);
    });
    it("does not export or fetch before the source is decoded", async () => {
        await render(); expect(button().disabled).toBe(true); await confirm();
        expect(done).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
    it("fits the image and selection wrapper to the stage without stretching or clipping", async () => {
        await render(); await load(); await select();
        await act(async () => resize([{ contentRect: { width: 500, height: 240 } } as ResizeObserverEntry], {} as ResizeObserver));
        expect(image.style.width).toBe("320px"); expect(image.style.height).toBe("240px");
        expect(mocks.crop!.style).toMatchObject({ width: 320, height: 240 });
        expect(mocks.crop!.crop).toMatchObject({ unit: "%", x: 20, y: 20, width: 50, height: 50 });
    });
    it("never silently exports the original image after a load error", async () => {
        await render(); await act(async () => image.dispatchEvent(new Event("error"))); await confirm();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("图片加载失败");
        expect(button().disabled).toBe(true); expect(done).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
    it("reports an empty canvas result and allows retrying", async () => {
        await render(); await load(); vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(cb => cb(null));
        await confirm(); expect(done).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("裁剪失败");
        await confirm(); expect(done).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it("reports unavailable canvas without passing an uncropped image to the caller", async () => {
        await render(); await load(); vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null); await confirm();
        expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(done).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
    it("ignores double confirmation while an export is pending", async () => {
        await render(); await load(); let finish!: BlobCallback;
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(cb => { finish = cb; });
        const confirmButton = button(); await act(async () => { confirmButton.click(); confirmButton.click(); });
        expect(draw).toHaveBeenCalledTimes(1); expect(mocks.crop!.disabled).toBe(true);
        await act(async () => finish(syntheticBlob())); expect(done).toHaveBeenCalledTimes(1);
    });
    it.each(["close", "replace", "unmount"])("discards a pending export after %s", async action => {
        await render(); await load(); let finish!: BlobCallback;
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(cb => { finish = cb; });
        await confirm();
        if (action === "close") await act(async () => button("取消").click());
        else if (action === "replace") await render("blob:second");
        else await render("blob:first", false);
        await act(async () => finish(syntheticBlob())); expect(done).not.toHaveBeenCalled();
    });
});
