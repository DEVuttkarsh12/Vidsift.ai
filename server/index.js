require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const extractAudio = require('./extractAudio');
const transcribeAudio = require('./transcribeAudio');
const cutVideo = require('./cutVideo');

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists (used as temp storage)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /mp4|mov|avi|mkv/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Videos Only!');
        }
    }
});

// Routes

// 1. Generate Signature for Direct-to-Cloud Upload
app.get('/api/generate-signature', (req, res) => {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request({
        timestamp: timestamp,
        folder: 'vidsift_uploads',
    }, process.env.CLOUDINARY_API_SECRET);

    res.json({
        signature,
        timestamp,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        folder: 'vidsift_uploads'
    });
});

// 2. Analyze Cloudinary URL (Direct-to-Cloud Flow)
app.post('/api/analyze-cloudinary', async (req, res) => {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ message: 'Missing videoUrl' });

    let localAudioPath = null;
    try {
        console.log('Processing remote video from Cloudinary...');
        // FFmpeg can read directly from the URL
        localAudioPath = await extractAudio(videoUrl, uploadDir);

        console.log('Transcribing audio...');
        const transcript = await transcribeAudio(localAudioPath);

        // Cleanup local audio
        if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);

        res.json({
            message: 'Analysis complete',
            videoUrl: videoUrl,
            transcript: transcript
        });
    } catch (error) {
        console.error('Remote processing error:', error);
        if (localAudioPath && fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
        res.status(500).json({ message: `Processing Error: ${error.message}` });
    }
});

// 3. Legacy Upload (Keep for safety/small files fallback if needed)
app.post('/api/upload', (req, res) => {
    upload.single('video')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ message: 'File too large. Max limit is 500MB.' });
            }
            return res.status(400).json({ message: `Upload Error: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ message: `Server Error: ${err.message}` });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        let localVideoPath = req.file.path;
        let localAudioPath = null;

        try {
            console.log('Uploading video to Cloudinary...');
            const cloudVideo = await cloudinary.uploader.upload(localVideoPath, {
                resource_type: "video",
                folder: "clipsense_uploads"
            });
            console.log('Cloudinary upload complete:', cloudVideo.secure_url);

            // Extract audio from the local temp video
            console.log('Extracting audio locally...');
            localAudioPath = await extractAudio(localVideoPath, uploadDir);

            // Transcribe audio using local Whisper
            console.log('Transcribing audio...');
            const transcript = await transcribeAudio(localAudioPath);
            console.log('Transcription complete.');

            // Cleanup local files
            fs.unlink(localVideoPath, (err) => {
                if (err) console.error('Error deleting local video:', err);
            });
            fs.unlink(localAudioPath, (err) => {
                if (err) console.error('Error deleting local audio:', err);
            });

            res.status(200).json({
                message: 'Analysis complete and synced to cloud',
                videoUrl: cloudVideo.secure_url,
                transcript: transcript
            });
        } catch (error) {
            console.error('Server error:', error);

            // Cleanup on error
            if (fs.existsSync(localVideoPath)) fs.unlinkSync(localVideoPath);
            if (localAudioPath && fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);

            res.status(500).json({
                message: `Server Error: ${error.message}`,
                details: error.stack
            });
        }
    });
});

app.get('/api/download-clip', async (req, res) => {
    const { videoUrl, start, end } = req.query;
    console.log(`Download request: videoUrl=${videoUrl}, start=${start}, end=${end}`);

    if (!videoUrl || start === undefined) {
        return res.status(400).json({ message: 'Missing parameters: videoUrl, start' });
    }

    try {
        const startTime = parseFloat(start);
        let endTime = parseFloat(end);

        if (isNaN(endTime) || endTime <= startTime) {
            endTime = startTime + 5;
        }

        // Use Cloudinary URL transformation for clipping to save server RAM
        // Format: .../video/upload/so_<start>,eo_<end>,fl_attachment/<public_id>
        if (videoUrl.includes('cloudinary.com')) {
            const transformation = `so_${startTime},eo_${endTime},fl_attachment`;
            const transformedUrl = videoUrl.replace('/video/upload/', `/video/upload/${transformation}/`);
            console.log('Redirecting to Cloudinary clip:', transformedUrl);
            return res.redirect(transformedUrl);
        }

        // Fallback for local development (not used in production)
        const tempVideoName = `temp_${Date.now()}.mp4`;
        const localVideoPath = path.join(uploadDir, tempVideoName);
        const axios = require('axios');
        const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(localVideoPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const clipPath = await require('./cutVideo')(localVideoPath, startTime, endTime, uploadDir);
        res.download(clipPath, (err) => {
            if (err) console.error('Download error:', err);
            fs.unlink(localVideoPath, (e) => { if (e) console.error(e); });
            fs.unlink(clipPath, (e) => { if (e) console.error(e); });
        });
    } catch (error) {
        console.error('Clip generation error:', error);
        res.status(500).json({
            message: `Error generating video clip: ${error.message}`,
            details: error.stack
        });
    }
});

app.get('/', (req, res) => {
    res.send('ClipSense API is running...');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
