import type { PercentCrop } from "react-image-crop";

/** Convert the visible normalized selection to source pixels, never CSS pixels.
 * Round edges together so canvas size and drawImage use exactly the same region.
 */
export function sourceCropRect(crop: PercentCrop, width: number, height: number) {
    if (crop.unit !== "%" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0
        || ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
        || crop.width <= 0 || crop.height <= 0) return null;

    const clamp = (value: number) => Math.min(100, Math.max(0, value));
    const left = clamp(crop.x), top = clamp(crop.y);
    const right = clamp(crop.x + crop.width), bottom = clamp(crop.y + crop.height);
    if (right <= left || bottom <= top) return null;

    const x = Math.min(width - 1, Math.round(left * width / 100));
    const y = Math.min(height - 1, Math.round(top * height / 100));
    const endX = Math.min(width, Math.max(x + 1, Math.round(right * width / 100)));
    const endY = Math.min(height, Math.max(y + 1, Math.round(bottom * height / 100)));
    return { x, y, width: endX - x, height: endY - y };
}
