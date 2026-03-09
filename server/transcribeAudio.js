const fs = require('fs');
const Groq = require('groq-sdk');

// Initialize Groq if key exists
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

async function transcribeAudio(audioPath) {
    // Check if we should use Groq (Fast & Light for Cloud)
    if (groq) {
        console.log('Using Cloud Transcription (Groq)...');
        try {
            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(audioPath),
                model: "whisper-large-v3",
                response_format: "verbose_json",
            });

            // Map Groq response to our internal format
            return transcription.segments.map(segment => ({
                time: segment.start,
                time_end: segment.end,
                text: segment.text.trim()
            }));
        } catch (error) {
            console.error('Groq API Error:', error.message);
            throw new Error(`Cloud Transcription Failed: ${error.message}. Please check your Groq API quota and limits.`);
        }
    } else {
        // Enforce cloud-only for production to prevent OOM
        if (process.env.RAILWAY_STATIC_URL || process.env.NODE_ENV === 'production') {
            throw new Error("GROQ_API_KEY is missing. Local transcription is disabled in production to prevent crashes. Please add GROQ_API_KEY to your Railway variables.");
        }
        return fallbackToLocal(audioPath);
    }
}

async function fallbackToLocal(audioPath) {
    console.log('Using Local Transcription (Whisper-OOD)...');
    const { pipeline } = require('@xenova/transformers');
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');

    const output = await transcriber(audioPath, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true
    });

    if (Array.isArray(output.chunks)) {
        return output.chunks.map(chunk => ({
            time: chunk.timestamp[0],
            time_end: chunk.timestamp[1],
            text: chunk.text.trim()
        }));
    } else {
        return [{
            time: 0,
            text: output.text.trim()
        }];
    }
}

module.exports = transcribeAudio;
