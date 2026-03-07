const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Extracts audio from a video file and saves it as a WAV file.
 * @param {string} videoPath - Full path to the source video file.
 * @param {string} outputDir - Directory to save the extracted audio.
 * @returns {Promise<string>} - The path to the extracted audio file.
 */
const extractAudio = (videoPath, outputDir) => {
    return new Promise((resolve, reject) => {
        const outputFilename = `${Date.now()}_audio.wav`;
        const outputPath = path.join(outputDir, outputFilename);

        ffmpeg(videoPath)
            .toFormat('wav')
            .audioFrequency(16000) // Required by Whisper
            .audioChannels(1)      // Required by Whisper
            .on('end', () => {
                console.log('Audio extraction finished:', outputPath);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('Error during audio extraction:', err);
                reject(err);
            })
            .save(outputPath);
    });
};

module.exports = extractAudio;
