export type RecordingState = {
    blob: Blob;
    url: string;
    durationMs: number;
};

export type IntentAlternative = {
    label: string;
    percentage: number;
    reasoning: string;
};

export type AnalysisResult = {
    summary: string;
    transcript: string;
    guidance: string;
    alternatives: IntentAlternative[];
};

