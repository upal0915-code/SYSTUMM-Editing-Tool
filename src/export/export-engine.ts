// ═══════════════════════════════════════════════════════════════
// EXPORT ENGINE — WebCodecs + MediaBunny
// File: src/export/export-engine.ts
// OpenReel pattern se adapted for automtion-video-editor
// ═══════════════════════════════════════════════════════════════

import type {
    VideoExportSettings,
    AudioExportSettings,
    ExportProgress,
    ExportResult,
    ExportError,
    ExportErrorCode,
    ExportStats,
    ExportPreset,
} from "./types";
import {
    DEFAULT_VIDEO_SETTINGS,
    DEFAULT_AUDIO_SETTINGS,
    VIDEO_QUALITY_PRESETS,
} from "./types";

// Aapke existing types — adjust path agar zaroorat ho
import type { Track, MediaFile } from "../types/editor";

// ── Project data structure ───────────────────────────────────────
interface ProjectData {
    tracks: Track[];
    mediaFiles: MediaFile[];
    duration: number;
    aspectRatio: string;
}

// ── Resolve canvas dimensions from aspect ratio ──────────────────
function getCanvasDimensions(
    aspectRatio: string,
    targetWidth: number
): { w: number; h: number } {
    const ratioMap: Record<string, number> = {
        "16:9": 9 / 16,
        "9:16": 16 / 9,
        "1:1": 1,
        "4:3": 3 / 4,
        "21:9": 9 / 21,
    };
    const ratio = ratioMap[aspectRatio] ?? 9 / 16;
    return { w: targetWidth, h: Math.round(targetWidth * ratio) };
}

// ════════════════════════════════════════════════════════════════
// MAIN EXPORT ENGINE CLASS
// ════════════════════════════════════════════════════════════════
export class ExportEngine {
    private mediabunny: typeof import("mediabunny") | null = null;
    private initialized = false;
    private abortController: AbortController | null = null;
    private currentExport: { startTime: number; framesRendered: number } | null = null;

    // ── Initialize: MediaBunny load karo ────────────────────────────
    async initialize(): Promise<void> {
        if (this.initialized) return;
        try {
            // Dynamic import — CDN/npm se load
            this.mediabunny = await import("mediabunny");
        } catch (error) {
            console.warn("[ExportEngine] MediaBunny not available:", error);
            this.mediabunny = null;
        }
        this.initialized = true;
    }

    // ── Check karo MediaBunny available hai ya nahi ────────────────
    isMediaBunnyAvailable(): boolean { return this.mediabunny !== null; }
    isWebCodecsSupported(): boolean {
        return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
    }
    isInitialized(): boolean { return this.initialized; }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error("ExportEngine not initialized. Call initialize() first.");
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN VIDEO EXPORT — OpenReel ka same pattern
    // ═══════════════════════════════════════════════════════════════
    async *exportVideo(
        project: ProjectData,
        settings: Partial<VideoExportSettings> = {},
        writableStream?: FileSystemWritableFileStream
    ): AsyncGenerator<ExportProgress, ExportResult> {
        this.ensureInitialized();

        // MediaBunny check
        if (!this.mediabunny) {
            const msg = this.isWebCodecsSupported()
                ? "MediaBunny library load nahi hui. Page refresh karke try karo."
                : "Video export ke liye WebCodecs API chahiye (Chrome/Edge use karo).";
            return { success: false, error: this.createError("UNSUPPORTED_CODEC", msg, "preparing") };
        }

        // Settings merge with defaults
        const fullSettings: VideoExportSettings = {
            ...DEFAULT_VIDEO_SETTINGS,
            ...settings,
            audioSettings: {
                ...DEFAULT_VIDEO_SETTINGS.audioSettings,
                ...settings.audioSettings,
            },
        };

        // Canvas dimensions calculate karo
        const { w: canvasW, h: canvasH } = getCanvasDimensions(
            project.aspectRatio,
            fullSettings.width
        );
        fullSettings.width = canvasW;
        fullSettings.height = canvasH;

        const totalFrames = Math.ceil(project.duration * fullSettings.frameRate);
        if (totalFrames <= 0) {
            return { success: false, error: this.createError("INVALID_SETTINGS", "Timeline empty hai", "preparing") };
        }

        this.abortController = new AbortController();
        const { signal } = this.abortController;
        this.currentExport = { startTime: Date.now(), framesRendered: 0 };

        // File save karna — showSaveFilePicker ya blob mode
        let bytesWritten = 0;
        const chunks: Uint8Array[] = [];

        const {
            Output,
            StreamTarget,
            BufferTarget,
            Mp4OutputFormat,
            WebMOutputFormat,
            VideoSampleSource,
            AudioBufferSource,
            getFirstEncodableVideoCodec,
            getFirstEncodableAudioCodec,
            QUALITY_MEDIUM,
        } = this.mediabunny;

        try {
            yield this.createProgress("preparing", 0, totalFrames, 0, 0);

            // ── Setup output format ──────────────────────────────────────
            let outputFormat: InstanceType<typeof Mp4OutputFormat | typeof WebMOutputFormat>;
            switch (fullSettings.format) {
                case "webm": outputFormat = new WebMOutputFormat(); break;
                default: outputFormat = new Mp4OutputFormat({ fastStart: false }); break;
            }

            let output: InstanceType<typeof Output>;

            if (writableStream) {
                // File System Access API — direct disk write (OpenReel method)
                const diskWriter = writableStream;
                const chunkWriter = {
                    async write(chunk: { data: Uint8Array; position: number }) {
                        const buf = chunk.data.buffer.slice(
                            chunk.data.byteOffset,
                            chunk.data.byteOffset + chunk.data.byteLength
                        ) as ArrayBuffer;
                        await diskWriter.seek(chunk.position);
                        await diskWriter.write(buf);
                        bytesWritten += chunk.data.byteLength;
                    },
                };
                const target = new StreamTarget(chunkWriter, { chunked: true, chunkSize: 4 * 1024 * 1024 });
                output = new Output({ format: outputFormat, target });
            } else {
                // Fallback: Buffer mein collect karo
                const target = new BufferTarget();
                output = new Output({ format: outputFormat, target });
            }

            // ── Video codec select karo ──────────────────────────────────
            const videoCodec = await getFirstEncodableVideoCodec(
                outputFormat.getSupportedVideoCodecs(),
                { width: fullSettings.width, height: fullSettings.height }
            );
            if (!videoCodec) {
                throw this.createError("UNSUPPORTED_CODEC", "No supported video codec found", "preparing");
            }

            // ── Audio codec select karo ──────────────────────────────────
            const supportedAudioCodecs = outputFormat.getSupportedAudioCodecs();
            const audioCodec = await getFirstEncodableAudioCodec(supportedAudioCodecs) || "aac";

            // ── Video source create karo ─────────────────────────────────
            const videoSource = new VideoSampleSource({
                codec: videoCodec,
                bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : QUALITY_MEDIUM,
                keyFrameInterval: fullSettings.keyframeInterval / fullSettings.frameRate,
                hardwareAcceleration: "prefer-hardware",
            });

            // ── Audio source create karo ─────────────────────────────────
            const audioSource = new AudioBufferSource({
                codec: audioCodec as "aac" | "opus" | "mp3",
                bitrate: fullSettings.audioSettings.bitrate * 1000,
            });

            output.addVideoTrack(videoSource);
            output.addAudioTrack(audioSource);
            await output.start();

            // ── Audio render aur encode karo (PEHLE) ────────────────────
            // OpenReel ka same approach — audio first
            await this.encodeAudio(project, audioSource, fullSettings.audioSettings);
            audioSource.close();

            // ── Frame-by-frame render loop ───────────────────────────────
            const canvas = new OffscreenCanvas(fullSettings.width, fullSettings.height);
            const ctx = canvas.getContext("2d")!;

            for (let frame = 0; frame < totalFrames; frame++) {
                // Cancel check
                if (signal.aborted) {
                    throw this.createError("CANCELLED", "Export cancelled by user", "rendering");
                }

                const currentTime = frame / fullSettings.frameRate;

                // ── Frame render karo canvas pe ──────────────────────────
                await this.renderFrame(ctx, canvas, project, currentTime, fullSettings.width, fullSettings.height);

                // ── Frame ko VideoEncoder ko bhejo ───────────────────────
                const videoFrame = new VideoFrame(canvas, {
                    timestamp: Math.round(currentTime * 1_000_000), // microseconds
                    duration: Math.round(1_000_000 / fullSettings.frameRate),
                });
                await videoSource.add(videoFrame);
                videoFrame.close();

                this.currentExport!.framesRendered = frame + 1;

                // ── Breathing room — UI ko update hone do ────────────────
                if (frame % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                yield this.createProgress(
                    "rendering",
                    (frame + 1) / totalFrames,
                    totalFrames,
                    frame + 1,
                    bytesWritten
                );
            }

            videoSource.close();

            // ── Muxing phase ─────────────────────────────────────────────
            yield this.createProgress("muxing", 0.98, totalFrames, totalFrames, bytesWritten);

            await output.finalize();

            // ── Disk stream close karo ya blob download karo ─────────────
            if (writableStream) {
                await writableStream.close();
            } else {
                // BufferTarget se blob le lo aur download karo
                const buffer = (output as any).target?.buffer;
                if (buffer) {
                    const blob = new Blob([buffer], { type: "video/mp4" });
                    bytesWritten = blob.size;
                    downloadBlob(blob, "export.mp4");
                }
            }

            yield this.createProgress("complete", 1, totalFrames, totalFrames, bytesWritten);
            return { success: true, stats: this.calculateStats(totalFrames, bytesWritten) };

        } catch (error) {
            try { writableStream && await writableStream.abort(); } catch { }
            if (error && typeof error === "object" && "code" in error) {
                return { success: false, error: error as ExportError };
            }
            return {
                success: false,
                error: this.createError(
                    "FRAME_ENCODE_FAILED",
                    error instanceof Error ? error.message : "Unknown error",
                    "rendering"
                ),
            };
        } finally {
            this.abortController = null;
            this.currentExport = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // FRAME RENDERER — Canvas 2D pe clips render karo
    // ═══════════════════════════════════════════════════════════════
    private async renderFrame(
        ctx: OffscreenCanvasRenderingContext2D,
        canvas: OffscreenCanvas,
        project: ProjectData,
        currentTime: number,
        width: number,
        height: number
    ): Promise<void> {
        // Background clear
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        // Har track ke clips render karo
        for (const track of project.tracks) {
            if (track.type === "audio") continue; // audio clips skip

            for (const clip of track.clips) {
                const clipStart = clip.startTime;
                const clipEnd = clip.startTime + clip.duration;

                if (currentTime < clipStart || currentTime >= clipEnd) continue;

                // Media file dhundho
                const mediaFile = project.mediaFiles.find(m => m.id === clip.mediaId);
                if (!mediaFile) continue;

                try {
                    if (mediaFile.type === "video") {
                        await this.renderVideoClip(ctx, canvas, mediaFile, clip, currentTime, width, height);
                    } else if (mediaFile.type === "image") {
                        await this.renderImageClip(ctx, mediaFile, clip, currentTime, width, height);
                    }
                } catch (e) {
                    // Clip render fail — black frame rakho
                    console.warn("Clip render failed:", e);
                }
            }
        }
    }

    private videoElements = new Map<string, HTMLVideoElement>();

    private async renderVideoClip(
        ctx: OffscreenCanvasRenderingContext2D,
        _canvas: OffscreenCanvas,
        mediaFile: MediaFile,
        clip: any,
        currentTime: number,
        width: number,
        height: number
    ): Promise<void> {
        let video = this.videoElements.get(mediaFile.id);
        if (!video) {
            video = document.createElement("video");
            video.src = mediaFile.url;
            video.muted = true;
            video.preload = "auto";
            this.videoElements.set(mediaFile.id, video);
            await new Promise<void>((resolve) => {
                video!.onloadeddata = () => resolve();
                video!.onerror = () => resolve();
                setTimeout(resolve, 3000); // timeout fallback
            });
        }

        // Clip ke andar ka time calculate karo
        const clipLocalTime = (currentTime - clip.startTime) + (clip.trimStart ?? 0);
        const adjustedTime = clipLocalTime / (clip.speed ?? 1);

        if (Math.abs(video.currentTime - adjustedTime) > 0.1) {
            video.currentTime = adjustedTime;
            await new Promise<void>((resolve) => {
                video!.onseeked = () => resolve();
                setTimeout(resolve, 500);
            });
        }

        // Transform apply karo
        const t = clip.transform;
        const scale = t?.scale ?? 1;
        const opacity = t?.opacity ?? 1;
        const posX = t?.posX ?? 0;
        const posY = t?.posY ?? 0;

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(width / 2 + posX, height / 2 + posY);
        ctx.scale(scale, scale);
        ctx.drawImage(video, -width / 2, -height / 2, width, height);
        ctx.restore();
    }

    private imageCache = new Map<string, ImageBitmap>();

    private async renderImageClip(
        ctx: OffscreenCanvasRenderingContext2D,
        mediaFile: MediaFile,
        clip: any,
        _currentTime: number,
        width: number,
        height: number
    ): Promise<void> {
        let bitmap = this.imageCache.get(mediaFile.id);
        if (!bitmap) {
            const response = await fetch(mediaFile.url);
            const blob = await response.blob();
            bitmap = await createImageBitmap(blob);
            this.imageCache.set(mediaFile.id, bitmap);
        }

        const t = clip.transform;
        const scale = t?.scale ?? 1;
        const opacity = t?.opacity ?? 1;
        const posX = t?.posX ?? 0;
        const posY = t?.posY ?? 0;

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(width / 2 + posX, height / 2 + posY);
        ctx.scale(scale, scale);

        // Cover fit maintain karo
        const scaleW = width / bitmap.width;
        const scaleH = height / bitmap.height;
        const s = Math.max(scaleW, scaleH);
        const dw = bitmap.width * s;
        const dh = bitmap.height * s;
        ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    // AUDIO ENCODER
    // ═══════════════════════════════════════════════════════════════
    private async encodeAudio(
        project: ProjectData,
        audioSource: any,
        _settings: AudioExportSettings
    ): Promise<void> {
        if (!this.mediabunny) return;
        const { AudioSample } = this.mediabunny;

        // Web Audio API se audio render karo
        const audioCtx = new OfflineAudioContext(
            2,
            Math.ceil(project.duration * 48000),
            48000
        );

        let hasAudio = false;

        for (const track of project.tracks) {
            if (track.type === "video") continue; // sirf audio tracks

            for (const clip of track.clips) {
                const mediaFile = project.mediaFiles.find(m => m.id === clip.mediaId);
                if (!mediaFile || mediaFile.type !== "audio") continue;

                try {
                    const response = await fetch(mediaFile.url);
                    const arrayBuffer = await response.arrayBuffer();
                    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                    const source = audioCtx.createBufferSource();
                    source.buffer = decodedBuffer;

                    const gainNode = audioCtx.createGain();
                    gainNode.gain.value = 1.0;

                    source.connect(gainNode);
                    gainNode.connect(audioCtx.destination);

                    const offset = clip.trimStart ?? 0;
                    const duration = Math.min(clip.duration, decodedBuffer.duration - offset);
                    source.start(clip.startTime, offset, duration);
                    hasAudio = true;
                } catch (e) {
                    console.warn("Audio clip encode failed:", e);
                }
            }
        }

        if (!hasAudio) {
            // Silent audio track — required for video
            const silentBuffer = audioCtx.createBuffer(2, Math.ceil(project.duration * 48000), 48000);
            const source = audioCtx.createBufferSource();
            source.buffer = silentBuffer;
            source.connect(audioCtx.destination);
            source.start(0);
        }

        const renderedBuffer = await audioCtx.startRendering();

        // AudioBuffer ko samples mein convert karo aur MediaBunny ko do
        const samples = AudioSample.fromAudioBuffer(renderedBuffer, 0);
        for (const sample of samples) {
            await audioSource.add(sample);
            sample.close();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SIMPLE EXPORT — showSaveFilePicker use karo (OpenReel pattern)
    // ═══════════════════════════════════════════════════════════════
    async exportWithFilePicker(
        project: ProjectData,
        settings: Partial<VideoExportSettings> = {},
        onProgress?: (progress: ExportProgress) => void
    ): Promise<ExportResult> {
        await this.initialize();

        // File picker open karo
        let writableStream: FileSystemWritableFileStream | undefined;
        try {
            const fileHandle = await (window as any).showSaveFilePicker({
                suggestedName: "export.mp4",
                types: [
                    {
                        description: "Video File",
                        accept: {
                            "video/mp4": [".mp4"],
                            "video/webm": [".webm"],
                        },
                    },
                ],
            });
            writableStream = await fileHandle.createWritable();
        } catch (e) {
            // User ne cancel kiya ya File System API available nahi
            // Fallback to blob download
            writableStream = undefined;
        }

        // Export run karo
        let lastResult: ExportResult = { success: false };
        for await (const progress of this.exportVideo(project, settings, writableStream)) {
            if ("phase" in progress) {
                onProgress?.(progress as ExportProgress);
                lastResult = { success: false }; // intermediate
            } else {
                lastResult = progress as ExportResult;
            }
        }
        return lastResult;
    }

    // ── Cancel export ────────────────────────────────────────────────
    cancel(): void {
        this.abortController?.abort();
    }

    // ── Presets — OpenReel se same ───────────────────────────────────
    getPresets(): ExportPreset[] {
        return [
            {
                id: "youtube-1080p",
                name: "YouTube 1080p",
                description: "Standard 1080p for YouTube — H.264",
                category: "social",
                settings: { ...DEFAULT_VIDEO_SETTINGS, ...VIDEO_QUALITY_PRESETS["1080p"], codec: "h264" },
            },
            {
                id: "youtube-4k",
                name: "YouTube 4K",
                description: "4K UHD for YouTube — H.264",
                category: "social",
                settings: { ...DEFAULT_VIDEO_SETTINGS, ...VIDEO_QUALITY_PRESETS["4k"], codec: "h264" },
            },
            {
                id: "tiktok-reels",
                name: "TikTok / Reels",
                description: "Vertical 1080x1920 for TikTok/Instagram Reels",
                category: "social",
                settings: { ...DEFAULT_VIDEO_SETTINGS, width: 1080, height: 1920, bitrate: 8000, frameRate: 30, codec: "h264" },
            },
            {
                id: "web-720p",
                name: "Web 720p (VP9)",
                description: "WebM VP9 for web embedding",
                category: "web",
                settings: { ...DEFAULT_VIDEO_SETTINGS, format: "webm", codec: "vp9", ...VIDEO_QUALITY_PRESETS["720p"] },
            },
            {
                id: "hq-1080p",
                name: "High Quality 1080p",
                description: "High bitrate 1080p for professional use",
                category: "broadcast",
                settings: { ...DEFAULT_VIDEO_SETTINGS, ...VIDEO_QUALITY_PRESETS["1080p-high"], codec: "h264" },
            },
            {
                id: "audio-mp3",
                name: "MP3 Audio Only",
                description: "MP3 320kbps audio extraction",
                category: "custom",
                settings: DEFAULT_AUDIO_SETTINGS,
            },
        ];
    }

    // ── Estimate file size ───────────────────────────────────────────
    estimateFileSize(duration: number, settings: VideoExportSettings): number {
        const videoBitrate = settings.bitrate * 1000;
        const audioBitrate = settings.audioSettings.bitrate * 1000;
        return Math.ceil(((videoBitrate + audioBitrate) * duration) / 8);
    }

    // ── Helper: Progress object banaao ──────────────────────────────
    private createProgress(
        phase: ExportProgress["phase"],
        progress: number,
        totalFrames: number,
        currentFrame: number,
        bytesWritten: number
    ): ExportProgress {
        const elapsed = this.currentExport
            ? (Date.now() - this.currentExport.startTime) / 1000
            : 0;
        const framesPerSecond = elapsed > 0 ? currentFrame / elapsed : 0;
        const remainingFrames = totalFrames - currentFrame;
        const estimatedTimeRemaining = framesPerSecond > 0
            ? remainingFrames / framesPerSecond
            : 0;
        return {
            phase,
            progress,
            estimatedTimeRemaining,
            currentFrame,
            totalFrames,
            bytesWritten,
            currentBitrate: elapsed > 0 ? (bytesWritten * 8) / elapsed : 0,
        };
    }

    // ── Helper: Error banaao ─────────────────────────────────────────
    private createError(
        code: ExportErrorCode,
        message: string,
        phase: ExportProgress["phase"]
    ): ExportError {
        return { code, message, phase, recoverable: code === "CANCELLED" };
    }

    // ── Helper: Stats calculate karo ────────────────────────────────
    private calculateStats(totalFrames: number, fileSize: number): ExportStats {
        const duration = this.currentExport
            ? Date.now() - this.currentExport.startTime
            : 0;
        return {
            duration,
            framesRendered: totalFrames,
            averageSpeed: duration > 0 ? (totalFrames / duration) * 1000 : 0,
            fileSize,
            averageBitrate: duration > 0 ? (fileSize * 8000) / duration : 0,
        };
    }

    // ── Cleanup ──────────────────────────────────────────────────────
    dispose(): void {
        this.cancel();
        for (const video of this.videoElements.values()) {
            video.src = "";
        }
        this.videoElements.clear();
        for (const bitmap of this.imageCache.values()) {
            bitmap.close();
        }
        this.imageCache.clear();
        this.mediabunny = null;
        this.initialized = false;
    }
}

// ── Singleton pattern (OpenReel jaisa) ──────────────────────────
let exportEngineInstance: ExportEngine | null = null;

export function getExportEngine(): ExportEngine {
    if (!exportEngineInstance) {
        exportEngineInstance = new ExportEngine();
    }
    return exportEngineInstance;
}

export async function initializeExportEngine(): Promise<ExportEngine> {
    const engine = getExportEngine();
    await engine.initialize();
    return engine;
}

// ── Download blob utility ────────────────────────────────────────
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}