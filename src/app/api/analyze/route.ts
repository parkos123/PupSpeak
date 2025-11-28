import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const runtime = "nodejs";

const parseDataUrl = (payload: string) => {
    const match = payload.match(/^data:(.+);base64,(.+)$/);
    if (!match)
        throw new Error("Invalid audio payload.");
    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length)
        throw new Error("Audio buffer empty.");
    return { buffer, mimeType };
};

export async function POST(request: Request) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        return NextResponse.json({ error: "Missing OpenAI API key." }, { status: 500 });

    const client = new OpenAI({ apiKey });

    try {
        const formData = await request.formData();
        const description = formData.get("description");
        const audioPayload = formData.get("audio");

        if (typeof description !== "string" || description.trim().length < 12)
            return NextResponse.json({ error: "Description must contain at least 12 characters." }, { status: 400 });

        if (typeof audioPayload !== "string")
            return NextResponse.json({ error: "Audio sample missing." }, { status: 400 });

        const { buffer } = parseDataUrl(audioPayload);
        const audioFile = await toFile(buffer, "bark.webm");

        const transcription = await client.audio.transcriptions.create({
            file: audioFile,
            model: "gpt-4o-mini-transcribe",
            response_format: "text",
        });

        const prompt = `
You interpret dog barks for PupSpeak, turning them into natural human language.

Imagine the dog has a clear mood, intention, and a bit of personality. It’s okay to creatively infer context (what the dog might see, want, or feel) as long as it stays plausible for a real dog. Use casual, playful wording rather than formal or robotic language.

Reply with only valid JSON using exactly these keys:
- summary (string) – a short, punchy one-line gist of what the dog wants or feels, like a human text message.
- transcript (string) – a fuller first-person translation as if the dog is speaking in natural, conversational English.
- alternatives (array of exactly 4 objects) – each object must have percentage (integer), label (string), reasoning (string).

Percentages must be integers that sum to 100. No extra commentary outside the JSON.

Bark transcription:
${transcription}

Owner context:
${description}
        `.trim();

        const aiResponse = await client.responses.create({
            model: "gpt-4o-mini",
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: prompt,
                        },
                    ],
                },
            ],
        });

        const output = Array.isArray(aiResponse.output_text) ? aiResponse.output_text[0] : aiResponse.output_text;
        if (!output)
            throw new Error("Missing AI response payload.");
        const sanitized = output.replace(/```json|```/gi, "").trim();
        const parsed = JSON.parse(sanitized);
        if (!Array.isArray(parsed.alternatives) || parsed.alternatives.length !== 4)
            throw new Error("AI response missing alternatives.");

        const guidancePrompt = `
You just translated a dog's bark for PupSpeak. Using the insights below, write at most two warm, practical sentences telling the human what the dog is trying to communicate emotionally and how to respond so the dog feels understood.

Insights JSON:
${sanitized}

Keep the tone calm, friendly, and actionable. Do not mention AI or JSON. Plain text only.
        `.trim();

        const guidanceResponse = await client.responses.create({
            model: "gpt-4o-mini",
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: guidancePrompt,
                        },
                    ],
                },
            ],
        });

        const guidanceRaw = Array.isArray(guidanceResponse.output_text)
            ? guidanceResponse.output_text[0]
            : guidanceResponse.output_text;
        if (!guidanceRaw)
            throw new Error("Missing guidance response.");
        const guidance = guidanceRaw.replace(/```/g, "").trim();

        return NextResponse.json({
            summary: parsed.summary,
            alternatives: parsed.alternatives,
            transcript: parsed.transcript ?? String(transcription),
            guidance,
        });
    } catch (error) {
        if (error instanceof Error)
            return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ error: "Failed to analyze bark." }, { status: 500 });
    }
}

