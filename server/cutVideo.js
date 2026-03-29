const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Cuts a video segment from a source video file.
 * @param {string} videoPath - Full path to the source video file.
 * @param {number} start - Start time in seconds.
 * @param {number} end - End time in seconds.
 * @param {string} outputDir - Directory to save the cut clip.
 * @returns {Promise<string>} - Full path to the cut video clip.
 */
const cutVideo = (videoPath, start, end, outputDir) => {
    return new Promise((resolve, reject) => {
        let duration = end - start;
        if (isNaN(duration) || duration <= 0) {
            duration = 5; // Default to 5 seconds if duration is invalid
        }
        const filename = `clip_${Date.now()}.mp4`;
        const outputPath = path.join(outputDir, filename);

        ffmpeg(videoPath)
            .setStartTime(start)
            .setDuration(duration)
            .output(outputPath)
            .on('end', () => {
                console.log('Video clipping finished:', outputPath);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('Video clipping error:', err);
                reject(err);
            })
            .run();
    });
};

module.exports = cutVideo;
