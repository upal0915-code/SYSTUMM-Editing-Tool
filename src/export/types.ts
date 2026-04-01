// ═══════════════════════════════════════════════════════
// EXPORT TYPES — OpenReel style
// File: src/export/types.ts
// ═══════════════════════════════════════════════════════

export type UpscaleQuality = "fast" | "balanced" | "quality";

export interface UpscalingSettings {
    enabled: boolean;
    quality: UpscaleQuality;
    sharpening: number;
}

export const DEFAULT_UPSCALING_SETTINGS: UpscalingSettings = {
    enabled: false,
    quality: "balanced",
    sharpening: 0.3,
};

// ── Main Video Export Settings ──────────────────────────
export interface VideoExportSettings {
    format: "mp4" | "webm" | "mov";
    codec: "h264" | "h265" | "vp8" | "vp9" | "av1" | "prores";
    proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
    width: number;
    height: number;
    frameRate: number;
    bitrate: number;        // kbps mein
    bitrateMode: "cbr" | "vbr";
    quality: number;        // 0-100
    keyframeInterval: number;
    audioSettings: AudioExportSettings;
    colorDepth?: 8 | 10 | 12;
    upscaling?: UpscalingSettings;
}

// ── Audio Export Settings ───────────────────────────────
export interface AudioExportSettings {
    format: "mp3" | "wav" | "aac" | "flac" | "ogg";
    sampleRate: 44100 | 48000 | 96000;
    bitDepth: 16 | 24 | 32;
    bitrate: number;        // kbps mein
    channels: 1 | 2;
}

// ── Image Export Settings ───────────────────────────────
export interface ImageExportSettings {
    format: "jpg" | "png" | "webp";
    quality: number;
    width: number;
    height: number;
}

// ── Export Progress — UI ke liye ────────────────────────
export interface ExportProgress {
    readonly phase: "preparing" | "rendering" | "encoding" | "muxing" | "complete";
    readonly progress: number;             // 0-1
    readonly estimatedTimeRemaining: number;
    readonly currentFrame: number;
    readonly totalFrames: number;
    readonly bytesWritten: number;
    readonly currentBitrate: number;
}

// ── Export Preset ───────────────────────────────────────
export interface ExportPreset {
    id: string;
    name: string;
    description: string;
    settings: VideoExportSettings | AudioExportSettings | ImageExportSettings;
    category: "social" | "broadcast" | "web" | "archive" | "custom";
}

// ── Export Error ────────────────────────────────────────
export type ExportErrorCode =
    | "ENCODER_INIT_FAILED"
    | "FRAME_ENCODE_FAILED"
    | "AUDIO_ENCODE_FAILED"
    | "MUXER_ERROR"
    | "DISK_FULL"
    | "CANCELLED"
    | "TIMEOUT"
    | "MEMORY_EXCEEDED"
    | "UNSUPPORTED_CODEC"
    | "INVALID_SETTINGS";

export interface ExportError {
    code: ExportErrorCode;
    message: string;
    phase: ExportProgress["phase"];
    frameNumber?: number;
    recoverable: boolean;
}

// ── Export Result ───────────────────────────────────────
export interface ExportResult {
    success: boolean;
    blob?: Blob;
    error?: ExportError;
    stats?: ExportStats;
}

export interface ExportStats {
    duration: number;
    framesRendered: number;
    averageSpeed: number;
    fileSize: number;
    averageBitrate: number;
}

// ── Default Settings ────────────────────────────────────
export const DEFAULT_VIDEO_SETTINGS: VideoExportSettings = {
    format: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 8000,    // 8 Mbps
    bitrateMode: "cbr",
    quality: 80,
    keyframeInterval: 60,
    audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 192,
        channels: 2,
    },
};

export const DEFAULT_AUDIO_SETTINGS: AudioExportSettings = {
    format: "mp3",
    sampleRate: 48000,
    bitDepth: 16,
    bitrate: 320,
    channels: 2,
};

// ── Quality Presets ─────────────────────────────────────
export const VIDEO_QUALITY_PRESETS = {
    "4k": {
        width: 3840, height: 2160, bitrate: 50000, frameRate: 30, quality: 90
    },
    "1080p-high": {
        width: 1920, height: 1080, bitrate: 25000, frameRate: 30, quality: 95
    },
    "1080p": {
        width: 1920, height: 1080, bitrate: 8000, frameRate: 30, quality: 80
    },
    "1080p-60": {
        width: 1920, height: 1080, bitrate: 15000, frameRate: 60, quality: 85
    },
    "720p": {
        width: 1280, height: 720, bitrate: 5000, frameRate: 30, quality: 75
    },
    "480p": {
        width: 854, height: 480, bitrate: 2500, frameRate: 30, quality: 70
    },
} as const;