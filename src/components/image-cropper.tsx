"use client";

import { useState, useRef, useEffect, type SyntheticEvent } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { sourceCropRect } from "@/lib/image-crop";

interface ImageCropperProps {
    imageSrc: string;
    open: boolean;
    onClose: () => void;
    onCropComplete: (croppedImageBlob: Blob) => void;
}

// Closing/reopening or changing the source creates a fresh editing session.
export function ImageCropper(props: ImageCropperProps) {
    return props.open ? <CropperDialog key={props.imageSrc} {...props} /> : null;
}

function CropperDialog({ imageSrc, onClose, onCropComplete }: ImageCropperProps) {
    const { t, language } = useLanguage();
    const [crop, setCrop] = useState<PercentCrop>();
    const [natural, setNatural] = useState<{ width: number; height: number }>();
    const [stage, setStage] = useState<HTMLDivElement | null>(null);
    const [available, setAvailable] = useState({ width: 0, height: 0 });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const imgRef = useRef<HTMLImageElement>(null);
    const cropRef = useRef<PercentCrop | undefined>(undefined);
    const saving = useRef(false);
    const active = useRef(true);
    const zh = language === "zh";

    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);

    useEffect(() => {
        if (!stage) return;
        // Observe the untransformed content box, not the dialog's animated bbox.
        // Image, crop wrapper and selection must always share one display area.
        const observer = new ResizeObserver(([entry]) => {
            setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(stage);
        return () => observer.disconnect();
    }, [stage]);

    function updateCrop(next: PercentCrop) {
        cropRef.current = next;
        setCrop(next);
    }

    function onImageLoad(e: SyntheticEvent<HTMLImageElement>) {
        const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
        if (!width || !height) return;
        setNatural({ width, height });
        updateCrop({ unit: "%", x: 10, y: 25, width: 80, height: 50 });
        setError("");
    }

    function close() {
        active.current = false;
        onClose();
    }

    async function handleConfirm() {
        const image = imgRef.current, selection = cropRef.current;
        if (saving.current || !active.current || !natural || !image?.complete || !selection) return;
        const rect = sourceCropRect(selection, image.naturalWidth, image.naturalHeight);
        if (!rect) return;
        saving.current = true;
        setBusy(true);
        setError("");
        try {
            const canvas = document.createElement("canvas");
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas unavailable");
            ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(value => value ? resolve(value) : reject(new Error("Empty crop")), "image/jpeg");
            });
            // A canceled/previous image must never enter the caller's AI workflow.
            if (active.current) onCropComplete(blob);
        } catch {
            if (active.current) setError(zh ? "裁剪失败，请重试或重新选择图片。" : "Cropping failed. Please retry or select the image again.");
        } finally {
            if (active.current) {
                saving.current = false;
                setBusy(false);
            }
        }
    }

    const scale = natural ? Math.min(1, available.width / natural.width, available.height / natural.height) : 0;
    const display = { width: natural ? natural.width * scale : 0, height: natural ? natural.height * scale : 0 };
    const valid = !!(natural && crop && sourceCropRect(crop, natural.width, natural.height));

    return (
        <Dialog open onOpenChange={(isOpen) => !isOpen && close()}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 gap-0" style={{ height: "90dvh" }}>
                <DialogHeader className="p-4 border-b shrink-0">
                    <DialogTitle>{t.common.cropper?.title || "Crop Image"}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {t.common.cropper?.hint || "Drag to adjust crop area"}
                    </DialogDescription>
                </DialogHeader>

                <div ref={setStage} className="flex-1 min-h-0 bg-black w-full overflow-hidden flex items-center justify-center p-4">
                    <ReactCrop
                        crop={crop}
                        onChange={(_, percentCrop) => updateCrop(percentCrop)}
                        disabled={busy || !natural}
                        style={{ ...display, flexShrink: 0 }}
                    >
                        {/* Native img is needed for local blobs and natural pixel dimensions. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={imgRef}
                            alt={zh ? "待裁剪图片" : "Image to crop"}
                            src={imageSrc}
                            onLoad={onImageLoad}
                            onError={() => {
                                setNatural(undefined);
                                cropRef.current = undefined;
                                setCrop(undefined);
                                setError(zh ? "图片加载失败，请重新选择。" : "Image failed to load. Please select it again.");
                            }}
                            style={{ ...display, display: "block", maxWidth: "none", maxHeight: "none" }}
                        />
                    </ReactCrop>
                </div>

                <div className="p-4 border-t bg-background shrink-0">
                    {error && <p role="alert" className="text-sm text-red-600 mb-2">{error}</p>}
                    <div className="flex flex-wrap gap-2 justify-between items-center">
                        <p className="text-sm text-muted-foreground">
                            {t.common.cropper?.hint || "💡 Drag to adjust crop area"}
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={close}>{t.common.cancel || "Cancel"}</Button>
                            <Button disabled={busy || !valid} onClick={handleConfirm}>
                                {busy ? (zh ? "裁剪中…" : "Cropping…") : (t.common.confirm || "Confirm")}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
