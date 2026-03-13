const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Groq = require('groq-sdk');
const ffmpeg = require('fluent-ffmpeg');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Initialize Groq if key exists
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Segment length (10 minutes = 600s)
const CHUNK_DURATION = 600; 

async function transcribeAudio(inputSource, clientDuration = null, onProgress = null) {
    if (!groq) {
        if (process.env.RAILWAY_STATIC_URL || process.env.NODE_ENV === 'production') {
            throw new Error("GROQ_API_KEY is missing. Local transcription is disabled in production.");
        }
        return fallbackToLocal(inputSource);
    }

    let audioPath = inputSource;
    let isTempFile = false;

    try {
    // Total Stability: Rely on client metadata to avoid server-side binary dependency
    let duration = 0;
    const potentialDuration = parseFloat(clientDuration);
    
    // Note: audioPath is either a local path or a Cloudinary URL
    const isUrl = audioPath.startsWith('http');
        
        if (!isNaN(potentialDuration) && potentialDuration > 0) {
            duration = potentialDuration;
            console.log(`[Studio] Analysis locked to Client Metadata: ${duration.toFixed(2)}s`);
        } else {
            console.log('[Studio] Server-side probe required (Metadata Handover missing)...');
            try {
                duration = await getAudioDuration(audioPath);
                console.log(`[Studio] System Probed Duration: ${duration.toFixed(2)}s`);
            } catch (probeError) {
                console.error('[Studio] FFprobe Fatal Error:', probeError.message);
                throw new Error("Studio Setup Failure: Analysis binaries (FFmpeg) are currently being updated by the server. Please try again in 60 seconds.");
            }
        }

        if (duration <= CHUNK_DURATION) {
            return await transcribeSingleFile(audioPath);
        }

        const totalSegments = Math.ceil(duration / CHUNK_DURATION);
        console.log(`[Studio] Large Asset Detected. Sequencing into ${totalSegments} segments...`);
        const allSegments = [];
        const tempDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        // Hyper-Speed: Parallel Batch Processing
        // We process segments in batches of 3 to avoid hitting burst limits while gaining speed.
        const BATCH_SIZE = 3;
        
        for (let start = 0; start < duration; start += CHUNK_DURATION * BATCH_SIZE) {
            const batchPromises = [];
            
            for (let i = 0; i < BATCH_SIZE; i++) {
                const segmentStart = start + (i * CHUNK_DURATION);
                if (segmentStart >= duration) break;

                const segmentIndex = Math.floor(segmentStart / CHUNK_DURATION) + 1;
                const chunkPath = path.join(tempDir, `chunk_${jobId || Date.now()}_${segmentIndex}.mp3`);
                
                const processSegment = async () => {
                   try {
                        if (onProgress) {
                          onProgress(`Streaming Studio Segment ${segmentIndex}/${totalSegments}...`);
                        }

                        // Extract chunk directly from URL or file
                        await new Promise((resolve, reject) => {
                            ffmpeg(audioPath)
                                .setStartTime(segmentStart)
                                .setDuration(Math.min(CHUNK_DURATION, duration - segmentStart))
                                .output(chunkPath)
                                .on('end', resolve)
                                .on('error', reject)
                                .run();
                        });

                        console.log(`[Studio] Transcribing segment ${segmentIndex}/${totalSegments}...`);
                        
                        // Segment-Level Retries: Resilience for professional assets
                        let transcription = null;
                        let attempts = 0;
                        const maxAttempts = 3;

                        while (!transcription && attempts < maxAttempts) {
                          try {
                            attempts++;
                            transcription = await transcribeSingleFile(chunkPath);
                          } catch (err) {
                            console.warn(`[Studio] Attempt ${attempts} failed for segment ${segmentIndex}:`, err.message);
                            if (err.message.includes('rate_limit_exceeded')) {
                              throw err; // Catch in outer loop for graceful partial return
                            }
                            if (attempts >= maxAttempts) throw err;
                            await new Promise(r => setTimeout(r, 2000 * attempts));
                          }
                        }

                        return transcription.map(seg => ({
                            ...seg,
                            time: seg.time + segmentStart,
                            time_end: (seg.time_end || seg.time) + segmentStart
                        }));

                   } finally {
                        if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
                   }
                };

                batchPromises.push(processSegment());
            }

            try {
                const batchResults = await Promise.all(batchPromises);
                batchResults.forEach(res => allSegments.push(...res));
            } catch (err) {
                if (err.message.includes('rate_limit_exceeded')) {
                    console.error(`[Studio] Quota hit during batch. Delivering partial script.`);
                    allSegments.push({
                        time: start,
                        text: "[Studio Engine: Quota limit hit. Hyper-Speed paused. Delivery partial analysis...]"
                    });
                    return allSegments.sort((a,b) => a.time - b.time);
                }
                throw err;
            }

            // High-precision DYNAMIC delay to respect ASPH after each batch
            const baseDelay = 3000;
            const dynamicDelay = baseDelay + (Math.floor(start / CHUNK_DURATION) * 500); 
            console.log(`[Studio] Batch complete. Resting for ${dynamicDelay/1000}s...`);
            await new Promise(r => setTimeout(r, dynamicDelay));
        }

        return allSegments.sort((a,b) => a.time - b.time);

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
