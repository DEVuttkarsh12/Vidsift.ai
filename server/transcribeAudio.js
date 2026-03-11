const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Groq = require('groq-sdk');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath('ffmpeg');
ffmpeg.setFfprobePath('ffprobe');

// Initialize Groq if key exists
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Segment length (10 minutes = 600s)
const CHUNK_DURATION = 600; 

async function transcribeAudio(inputSource, clientDuration = null) {
    if (!groq) {
        if (process.env.RAILWAY_STATIC_URL || process.env.NODE_ENV === 'production') {
            throw new Error("GROQ_API_KEY is missing. Local transcription is disabled in production.");
        }
        return fallbackToLocal(inputSource);
    }

    let audioPath = inputSource;
    let isTempFile = false;

    try {
        // If input is a URL, download it locally first for reliable ffprobe/chunking
        if (inputSource.startsWith('http')) {
            console.log('[Studio] Downloading Cloud Asset for analysis...');
            const tempDir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            
            audioPath = path.join(tempDir, `transcribe_${Date.now()}.mp3`);
            isTempFile = true;
            
            const response = await axios({
                url: inputSource,
                method: 'GET',
                responseType: 'stream'
            });
            
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(audioPath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        }

        // Strict Duration Priority: Prefer client metadata to avoid server-side probe failures
        let duration = 0;
        if (clientDuration && !isNaN(parseFloat(clientDuration)) && parseFloat(clientDuration) > 0) {
            duration = parseFloat(clientDuration);
            console.log(`[Studio] Using Client Metadata Duration: ${duration.toFixed(2)}s`);
        } else {
            console.log('[Studio] Server-side probe required (No valid client metadata)...');
            duration = await getAudioDuration(audioPath);
            console.log(`[Studio] Probed Duration: ${duration.toFixed(2)}s`);
        }

        if (duration <= CHUNK_DURATION) {
            return await transcribeSingleFile(audioPath);
        }

        // Sequential Chunking for Large Assets (ASPH Management)
        console.log(`[Studio] Large Asset Detected. Sequencing into ${Math.ceil(duration / CHUNK_DURATION)} segments...`);
        const allSegments = [];
        const tempDir = path.dirname(audioPath);

        for (let start = 0; start < duration; start += CHUNK_DURATION) {
            const chunkPath = path.join(tempDir, `chunk_${Math.floor(start)}.mp3`);
            
            // Extract the chunk
            await new Promise((resolve, reject) => {
                ffmpeg(audioPath)
                    .setStartTime(start)
                    .setDuration(Math.min(CHUNK_DURATION, duration - start))
                    .output(chunkPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            console.log(`[Studio] Transcribing segment: ${Math.floor(start / 60)}m - ${Math.floor(Math.min(start + CHUNK_DURATION, duration) / 60)}m`);
            
            try {
                const transcription = await transcribeSingleFile(chunkPath);
                
                // Adjust timestamps for the combined transcript
                const offsetSegments = transcription.map(seg => ({
                    ...seg,
                    time: seg.time + start,
                    time_end: (seg.time_end || seg.time) + start
                }));
                allSegments.push(...offsetSegments);
            } catch (chunkError) {
                console.error(`[Studio] Segment Failure at ${start}s:`, chunkError.message);
                if (chunkError.message.includes('rate_limit_exceeded')) {
                  throw new Error(`Studio Quota Exceeded (ASPH): ${chunkError.message}. We transcribed ${Math.floor(start / 60)} minutes before hitting the limit.`);
                }
                throw chunkError;
            } finally {
                if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
            }

            // High-precision delay to respect burst limits (2s)
            await new Promise(r => setTimeout(r, 2000));
        }

        return allSegments;

    } catch (error) {
        console.error('Transcription Sequencing Error:', error.message);
        throw new Error(`Studio Analysis Failed: ${error.message}`);
    }
}

async function transcribeSingleFile(path) {
    const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(path),
        model: "whisper-large-v3",
        response_format: "verbose_json",
    });

    return transcription.segments.map(segment => ({
        time: segment.start,
        time_end: segment.end,
        text: segment.text.trim()
    }));
}

function getAudioDuration(path) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(path, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
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
