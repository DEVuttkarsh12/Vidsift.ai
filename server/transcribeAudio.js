const { pipeline } = require('@xenova/transformers');
const { WaveFile } = require('wavefile');
const fs = require('fs');

let transcriber = null;

/**
 * Transcribes an audio file using local Transformers.js Whisper.
 * @param {string} audioPath - Full path to the source audio file (WAV, 16kHz, mono).
 * @returns {Promise<Array>} - Array of transcript objects [{ text, time }].
 */
const transcribeAudio = async (audioPath) => {
    try {
        console.log(`Loading transcription model...`);
        if (!transcriber) {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
        }

        console.log(`Reading audio file: ${audioPath}`);
        const buffer = fs.readFileSync(audioPath);
        const wav = new WaveFile(buffer);

        // Whisper models expect 16kHz float32 mono audio
        wav.toBitDepth('32f');
        wav.toSampleRate(16000);
        let audioData = wav.getSamples();

        // If stereo, average the channels
        if (Array.isArray(audioData)) {
            console.log('Converting stereo to mono...');
            const mono = new Float32Array(audioData[0].length);
            for (let i = 0; i < audioData[0].length; ++i) {
                mono[i] = (audioData[0][i] + audioData[1][i]) / 2;
            }
            audioData = mono;
        }

        console.log('Running transcription...');
        const result = await transcriber(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true
        });

        console.log('Transcription complete.');

        // result.chunks is available when return_timestamps is true
        // Format: [{ text: '...', timestamp: [start, end] }]
        if (result.chunks) {
            return result.chunks.map(chunk => ({
                text: chunk.text.trim(),
                time: chunk.timestamp[0], // Start time
                time_end: chunk.timestamp[1] // End time
            }));
        }

        // Fallback if no chunks (unlikely with timestamps true)
        return [{ text: result.text.trim(), time: 0 }];

    } catch (error) {
        console.error('Transcription error Details:', error);
        throw error;
    }
};

module.exports = transcribeAudio;
