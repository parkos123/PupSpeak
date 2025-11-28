"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import dogLogo from "../../main_dog.png";
import { MicVocal, Sparkles, Square } from "lucide-react";
import type { AnalysisResult, RecordingState } from "../types";

const ATTEMPT_KEY = "pupspeak_attempts";
const REGISTRATION_KEY = "pupspeak_registered";

export default function Home() {
    const router = useRouter();
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunkRef = useRef<BlobPart[]>([]);
    const startRef = useRef<number | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recording, setRecording] = useState<RecordingState | null>(null);
    const [description, setDescription] = useState("");
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isRegistered, setIsRegistered] = useState(false);
    const [attemptCount, setAttemptCount] = useState(0);

    useEffect(() => {
        if (!recording)
            return undefined;
        return () => {
            URL.revokeObjectURL(recording.url);
        };
    }, [recording]);

    useEffect(() => {
        if (typeof window === "undefined")
            return;
        const params = new URLSearchParams(window.location.search);
        const cameFromRegistration = params.get("registred") === "true";
        if (cameFromRegistration) {
            localStorage.setItem(REGISTRATION_KEY, "true");
            localStorage.removeItem(ATTEMPT_KEY);
            setIsRegistered(true);
            setAttemptCount(0);
        }
        const storedRegistered = localStorage.getItem(REGISTRATION_KEY) === "true";
        const storedAttempts = Number(localStorage.getItem(ATTEMPT_KEY) ?? "0");
        setIsRegistered(storedRegistered);
        setAttemptCount(Number.isFinite(storedAttempts) ? storedAttempts : 0);
        requestAnimationFrame(() => {
            if (cameFromRegistration && window.location.pathname === "/")
                router.replace("/", { scroll: false });
        });
    }, [router]);

    useEffect(() => {
        if (!recording)
            return;
        setAnalysis(null);
    }, [recording]);

    const statusLabel = useMemo(() => {
        if (isRecording)
            return "Recording live bark";
        if (recording)
            return `Captured ${(recording.durationMs / 1000).toFixed(1)}s sample`;
        return "Idle";
    }, [isRecording, recording]);

    const ensureMediaStream = async () => {
        if (typeof navigator === "undefined")
            throw new Error("Audio capture is unavailable in this environment.");
        if (!navigator.mediaDevices?.getUserMedia)
            throw new Error("Microphone access not supported on this device.");
        return navigator.mediaDevices.getUserMedia({ audio: true });
    };

    const startRecording = async () => {
        if (isRecording)
            return;
        const stream = await ensureMediaStream();
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        chunkRef.current = [];
        startRef.current = performance.now();
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0)
                chunkRef.current.push(event.data);
        };
        recorder.onstop = () => {
            try {
                if (!chunkRef.current.length)
                    throw new Error("No audio data captured.");
                const blob = new Blob(chunkRef.current, { type: "audio/webm" });
                const url = URL.createObjectURL(blob);
                const durationMs = startRef.current ? performance.now() - startRef.current : 0;
                setRecording({ blob, url, durationMs });
                chunkRef.current = [];
                startRef.current = null;
            } catch (err) {
                if (err instanceof Error)
                    setError(err.message);
                else
                    setError("Unable to finalize recording.");
            }
        };
        recorder.start();
        setIsRecording(true);
    };

    const stopRecording = () => {
        if (!recorderRef.current)
            throw new Error("No active recording to stop.");
        recorderRef.current.stop();
        recorderRef.current.stream.getTracks().forEach((track) => {
            track.stop();
        });
        recorderRef.current = null;
        setIsRecording(false);
    };

    const handleRecordToggle = async () => {
        try {
            setError(null);
            if (isRecording)
                stopRecording();
            else
                await startRecording();
        } catch (err) {
            if (err instanceof Error)
                setError(err.message);
            else
                setError("Microphone control failed.");
        }
    };

    const interpretBark = async () => {
        try {
            setError(null);
            if (!isRegistered && attemptCount >= 2) {
                window.location.href = "https://pupspeak.eu/register";
                return;
            }
            if (!recording)
                throw new Error("Capture a bark sample first.");
            const trimmed = description.trim();
            if (trimmed.length < 12)
                throw new Error("Describe the situation with at least 12 characters.");
            setIsAnalyzing(true);
            const payload = {
                description: trimmed,
                audio: await encodeAudio(recording.blob),
            };
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const message = await response.json().catch(() => ({ error: "Unable to read server response." }));
                throw new Error(message.error ?? "Analysis failed.");
            }
            const result = (await response.json()) as AnalysisResult;
            if (!result.summary || !Array.isArray(result.alternatives))
                throw new Error("AI response incomplete.");
            setAnalysis(result);
            if (!isRegistered) {
                const nextCount = attemptCount + 1;
                localStorage.setItem(ATTEMPT_KEY, String(nextCount));
                setAttemptCount(nextCount);
                if (nextCount >= 2) {
                    setTimeout(() => {
                        window.location.href = "https://pupspeak.eu/register";
                    }, 500);
                }
            }
        } catch (err) {
            if (err instanceof Error)
                setError(err.message);
            else
                setError("Unexpected issue while interpreting the bark.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <main className="app-shell">
            <header className="brand-lockup">
                <h1>Translate your dog’s bark into human intent.</h1>
                <p>
                    PupSpeak listens to micro-patterns inside each bark, blends them with the context you provide, and returns a clear intent with confidence so you know how to respond. Outputs are AI-driven insights, so treat them as directional rather than guaranteed fact.
                </p>
            </header>
            <section className="capture-stack">
                <div className="record-pad">
                    <button
                        type="button"
                        className="record-btn"
                        data-state={isRecording ? "recording" : "idle"}
                        onClick={handleRecordToggle}
                    >
                        <span className="record-icon">
                            <Image
                                src={dogLogo}
                                alt="PupSpeak logo"
                                width={90}
                                height={90}
                                priority
                            />
                        </span>
                        <span className="record-copy">
                            {isRecording ? (
                                <>
                                    <Square size={24} />
                                    Stop capture
                                </>
                            ) : (
                                <>
                                    <MicVocal size={24} />
                                    Tap to capture bark
                                </>
                            )}
                        </span>
                    </button>
                    <p className="status">{statusLabel}</p>
                    <div className={`record-placeholder${recording ? " record-placeholder--filled" : ""}`}>
                        {recording ? (
                            <>
                                <audio controls src={recording.url} />
                                <p>{(recording.durationMs / 1000).toFixed(1)} seconds stored</p>
                            </>
                        ) : (
                            <p>Captured bark waveform will stretch across this bar once recording finishes.</p>
                        )}
                    </div>
                </div>
                <div className="context-block">
                    <label htmlFor="context-input">Describe what triggered the bark</label>
                    <textarea
                        id="context-input"
                        className="input-area"
                        value={description}
                        onChange={(event) => {
                            setDescription(event.target.value);
                        }}
                        placeholder="Example: Delivery driver stayed at the gate and rang twice."
                    />
                    <div className="context-actions">
                        <button
                            type="button"
                            className="cta"
                            onClick={interpretBark}
                            disabled={!recording || isAnalyzing}
                        >
                            <Sparkles size={18} />
                            {isAnalyzing ? "Analyzing..." : "Interpret bark"}
                        </button>
                    </div>
                    {error ? (
                        <p className="error">{error}</p>
                    ) : null}
                </div>
                {analysis ? (
                    <section className="result-panel" aria-live="polite">
                        <header className="result-header">
                            <div>
                                <p className="result-title">{analysis.summary}</p>
                                <p className="result-context">
                                    Context: {description || "No additional details provided"}
                                </p>
                            </div>
                            <span className="result-pill">AI insight</span>
                        </header>
                        <div className="result-translation">
                            <p className="result-translation__title">Dog says</p>
                            <p>{analysis.transcript}</p>
                        </div>
                        <div className="result-bars">
                            {analysis.alternatives.map((entry) => (
                                <details key={entry.label} className="result-bar">
                                    <summary>
                                        <div className="result-bar__label">
                                            <span>{entry.label}</span>
                                            <strong>{entry.percentage}%</strong>
                                        </div>
                                        <div className="result-bar__track">
                                            <div
                                                className="result-bar__fill"
                                                style={{ width: `${entry.percentage}%` }}
                                            />
                                        </div>
                                    </summary>
                                    <p className="result-bar__reason">{entry.reasoning}</p>
                                </details>
                            ))}
                        </div>
                        <div className="result-summary">
                            <p className="result-summary__title">What this means</p>
                            <p>{analysis.guidance}</p>
                        </div>
                    </section>
                ) : null}
            </section>
        </main>
    );
}

const encodeAudio = (blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read the audio sample."));
        reader.onloadend = () => {
            const result = reader.result;
            if (typeof result === "string")
                resolve(result);
            else
                reject(new Error("Audio encoding produced an invalid format."));
        };
        reader.readAsDataURL(blob);
    });
};
