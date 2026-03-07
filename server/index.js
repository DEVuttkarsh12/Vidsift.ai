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
app.use(cors()); // Temporarily allow all origins to rule out CORS issues
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Increase payload limits for video uploads
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));

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
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
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
app.post('/api/upload', upload.single('video'), async (req, res) => {
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

app.get('/api/download-clip', async (req, res) => {
    const { videoUrl, start, end } = req.query;
    console.log(`Download request: videoUrl=${videoUrl}, start=${start}, end=${end}`);

    if (!videoUrl || start === undefined) {
        return res.status(400).json({ message: 'Missing parameters: videoUrl, start' });
    }

    const tempVideoName = `temp_${Date.now()}.mp4`;
    const localVideoPath = path.join(uploadDir, tempVideoName);

    try {
        // Download from Cloudinary to local temp for cutting
        const axios = require('axios');
        const response = await axios({
            url: videoUrl,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(localVideoPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const startTime = parseFloat(start);
        let endTime = parseFloat(end);

        if (isNaN(endTime) || endTime <= startTime) {
            endTime = startTime + 5;
        }

        const clipPath = await cutVideo(localVideoPath, startTime, endTime, uploadDir);

        res.download(clipPath, (err) => {
            if (err) console.error('Download error:', err);

            // Cleanup all temp files
            fs.unlink(localVideoPath, (e) => { if (e) console.error(e); });
            fs.unlink(clipPath, (e) => { if (e) console.error(e); });
        });
    } catch (error) {
        console.error('Clip generation error:', error);
        if (fs.existsSync(localVideoPath)) fs.unlinkSync(localVideoPath);
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
