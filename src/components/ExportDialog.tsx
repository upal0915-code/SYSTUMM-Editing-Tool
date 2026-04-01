// ═══════════════════════════════════════════════════════════════
// EXPORT DIALOG — OpenReel style
// File: src/components/ExportDialog.tsx
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from "react";
import type { Track, MediaFile } from "../types/editor";
import {
    getExportEngine,
    downloadBlob,
} from "../export/export-engine";
import type {
    VideoExportSettings,
    ExportProgress,
    ExportPreset,
} from "../export/types";
import { DEFAULT_VIDEO_SETTINGS } from "../export/types";

// ── Props ────────────────────────────────────────────────────────
interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    tracks: Track[];
    mediaFiles: MediaFile[];
    duration: number;
    aspectRatio: string;
}

// ── Format file size ─────────────────────────────────────────────
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════
export default function ExportDialog({
    isOpen,
    onClose,
    tracks,
    mediaFiles,
    duration,
    aspectRatio,
}: ExportDialogProps) {
    const engine = getExportEngine();
    const presets = engine.getPresets();

    const [activeTab, setActiveTab] = useState<"presets" | "custom">("presets");
    const [selectedPreset, setSelectedPreset] = useState<ExportPreset>(presets[0]);
    const [customSettings, setCustomSettings] = useState<VideoExportSettings>({
        ...DEFAULT_VIDEO_SETTINGS,
    });
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);
    const cancelRef = useRef(false);

    const currentSettings =
        activeTab === "presets" ? (selectedPreset.settings as VideoExportSettings) : customSettings;

    // ── Start Export ──────────────────────────────────────────────
    const handleExport = useCallback(async () => {
        setIsExporting(true);
        setProgress(null);
        setExportResult(null);
        cancelRef.current = false;

        try {
            await engine.initialize();

            const project = { tracks, mediaFiles, duration, aspectRatio };
            const settings = "codec" in currentSettings ? currentSettings : DEFAULT_VIDEO_SETTINGS;
            const format = (settings as VideoExportSettings).format ?? "mp4";

            // File System Access API try karo
            let writableStream: FileSystemWritableFileStream | undefined;
            try {
                const fileHandle = await (window as any).showSaveFilePicker({
                    suggestedName: `export.${format}`,
                    types: [{
                        description: "Video File",
                        accept: {
                            "video/mp4": [".mp4"],
                            "video/webm": [".webm"],
                        },
                    }],
                });
                writableStream = await fileHandle.createWritable();
            } catch {
                // User cancelled file picker — blob mode use karo
                writableStream = undefined;
            }

            for await (const value of engine.exportVideo(project, settings, writableStream)) {
                if (cancelRef.current) break;

                if ("phase" in value && "progress" in value) {
                    setProgress(value as ExportProgress);
                } else if ("success" in value) {
                    const result = value as { success: boolean; error?: any; stats?: any };
                    if (result.success) {
                        const sizeStr = result.stats ? formatBytes(result.stats.fileSize) : "";
                        setExportResult({
                            success: true,
                            message: `Export complete! ${sizeStr ? `File size: ${sizeStr}` : "File saved."}`,
                        });
                    } else {
                        setExportResult({
                            success: false,
                            message: result.error?.message ?? "Export failed",
                        });
                    }
                }
            }
        } catch (e) {
            setExportResult({
                success: false,
                message: e instanceof Error ? e.message : "Export failed",
            });
        } finally {
            setIsExporting(false);
        }
    }, [engine, currentSettings, tracks, mediaFiles, duration, aspectRatio]);

    // ── Cancel Export ─────────────────────────────────────────────
    const handleCancel = useCallback(() => {
        cancelRef.current = true;
        engine.cancel();
    }, [engine]);

    if (!isOpen) return null;

    // ── Estimated size ─────────────────────────────────────────────
    const estimatedSize =
        "bitrate" in currentSettings
            ? engine.estimateFileSize(duration, currentSettings as VideoExportSettings)
            : 0;

    return (
        // Backdrop
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">

                {/* ── Header ─────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
                    <div>
                        <h2 className="text-white font-bold text-lg">Export Video</h2>
                        <p className="text-zinc-500 text-xs mt-0.5">
                            {Math.round(duration)}s • {aspectRatio} •{" "}
                            {estimatedSize > 0 ? `~${formatBytes(estimatedSize)} estimated` : ""}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isExporting}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
                    >
                        ✕
                    </button>
                </div>

                {/* ── Tabs ───────────────────────────────────────────── */}
                <div className="flex border-b border-zinc-800">
                    {(["presets", "custom"] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === tab
                                    ? "text-indigo-400 border-b-2 border-indigo-500"
                                    : "text-zinc-500 hover:text-zinc-300"
                                }`}
                        >
                            {tab === "presets" ? "🎯 Presets" : "⚙️ Custom"}
                        </button>
                    ))}
                </div>

                <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">

                    {/* ── PRESETS TAB ──────────────────────────────────── */}
                    {activeTab === "presets" && (
                        <div className="grid grid-cols-2 gap-3">
                            {presets.filter(p => "codec" in p.settings).map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => setSelectedPreset(preset)}
                                    className={`p-4 rounded-xl border text-left transition-all ${selectedPreset.id === preset.id
                                            ? "border-indigo-500 bg-indigo-900/30"
                                            : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                                        }`}
                                >
                                    <div className="font-medium text-white text-sm">{preset.name}</div>
                                    <div className="text-zinc-500 text-xs mt-1">{preset.description}</div>
                                    <div className="mt-2 flex gap-1 flex-wrap">
                                        {["codec" in preset.settings && (preset.settings as VideoExportSettings).format?.toUpperCase(),
                                        "codec" in preset.settings && (preset.settings as VideoExportSettings).codec?.toUpperCase(),
                                        "codec" in preset.settings && `${(preset.settings as VideoExportSettings).frameRate}fps`,
                                        ].filter(Boolean).map((tag, i) => (
                                            <span key={i} className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* ── CUSTOM TAB ───────────────────────────────────── */}
                    {activeTab === "custom" && (
                        <div className="space-y-4">

                            {/* Format */}
                            <div>
                                <label className="block text-zinc-400 text-xs mb-2">Format</label>
                                <div className="flex gap-2">
                                    {(["mp4", "webm"] as const).map(f => (
                                        <button
                                            key={f}
                                            onClick={() => setCustomSettings(s => ({ ...s, format: f }))}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${customSettings.format === f
                                                    ? "bg-indigo-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                                                }`}
                                        >
                                            {f.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Codec */}
                            <div>
                                <label className="block text-zinc-400 text-xs mb-2">Codec</label>
                                <div className="flex gap-2 flex-wrap">
                                    {(["h264", "h265", "vp9", "av1"] as const).map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setCustomSettings(s => ({ ...s, codec: c }))}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${customSettings.codec === c
                                                    ? "bg-indigo-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                                                }`}
                                        >
                                            {c.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Resolution */}
                            <div>
                                <label className="block text-zinc-400 text-xs mb-2">Resolution</label>
                                <div className="flex gap-2 flex-wrap">
                                    {([
                                        { label: "4K", w: 3840, h: 2160 },
                                        { label: "1080p", w: 1920, h: 1080 },
                                        { label: "720p", w: 1280, h: 720 },
                                        { label: "480p", w: 854, h: 480 },
                                    ]).map(r => (
                                        <button
                                            key={r.label}
                                            onClick={() => setCustomSettings(s => ({ ...s, width: r.w, height: r.h }))}
                                            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${customSettings.width === r.w
                                                    ? "bg-indigo-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                                                }`}
                                        >
                                            {r.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Frame Rate */}
                            <div>
                                <label className="block text-zinc-400 text-xs mb-2">Frame Rate</label>
                                <div className="flex gap-2">
                                    {([24, 30, 60] as const).map(fps => (
                                        <button
                                            key={fps}
                                            onClick={() => setCustomSettings(s => ({ ...s, frameRate: fps }))}
                                            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${customSettings.frameRate === fps
                                                    ? "bg-indigo-600 text-white"
                                                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                                                }`}
                                        >
                                            {fps} fps
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Bitrate */}
                            <div>
                                <label className="block text-zinc-400 text-xs mb-2">
                                    Bitrate: {customSettings.bitrate} kbps
                                </label>
                                <input
                                    type="range"
                                    min={1000}
                                    max={80000}
                                    step={1000}
                                    value={customSettings.bitrate}
                                    onChange={e => setCustomSettings(s => ({ ...s, bitrate: Number(e.target.value) }))}
                                    className="w-full accent-indigo-500"
                                />
                                <div className="flex justify-between text-xs text-zinc-600 mt-1">
                                    <span>1 Mbps (small)</span>
                                    <span>80 Mbps (max quality)</span>
                                </div>
                            </div>

                        </div>
                    )}

                    {/* ── Progress Section ──────────────────────────────── */}
                    {(isExporting || progress) && (
                        <div className="mt-4 space-y-3">
                            {progress && (
                                <>
                                    <div className="flex justify-between text-xs text-zinc-400">
                                        <span className="capitalize">{progress.phase}...</span>
                                        <span>
                                            {Math.round(progress.progress * 100)}% •{" "}
                                            {progress.phase !== "complete" && progress.estimatedTimeRemaining > 0
                                                ? `ETA: ${formatTime(progress.estimatedTimeRemaining)}`
                                                : ""}
                                        </span>
                                    </div>
                                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                            style={{ width: `${Math.round(progress.progress * 100)}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-xs text-zinc-600">
                                        <span>Frame {progress.currentFrame} / {progress.totalFrames}</span>
                                        <span>{formatBytes(progress.bytesWritten)} written</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ── Result Message ────────────────────────────────── */}
                    {exportResult && (
                        <div className={`p-4 rounded-xl ${exportResult.success
                                ? "bg-green-900/30 border border-green-700 text-green-300"
                                : "bg-red-900/30 border border-red-700 text-red-300"
                            }`}>
                            <div className="flex items-center gap-2 font-medium">
                                {exportResult.success ? "✅" : "❌"} {exportResult.message}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer Actions ──────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
                    {isExporting ? (
                        <>
                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                Exporting...
                            </div>
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleExport}
                                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-900/50"
                            >
                                🚀 Export Now
                            </button>
                        </>
                    )}
                </div>

            </div>
        </div>
    );
}