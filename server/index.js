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

// Job Store (In-memory for MVP)
const jobs = {};

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
        const filetypes = /mp4|mov|avi|mkv|wav|mp3|m4a/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = /video|audio/.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Error: Unregistered file format! Supported: mp4, mov, wav, mp3.'));
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

// 2. Analyze Cloudinary URL (Async Job Flow)
app.post('/api/analyze-cloudinary', async (req, res) => {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ message: 'Missing videoUrl' });

    const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    jobs[jobId] = { status: 'processing', progress: 0, videoUrl };

    // Start background processing
    (async () => {
        let localAudioPath = null;
        try {
            console.log(`[Job ${jobId}] Processing remote video...`);
            localAudioPath = await extractAudio(videoUrl, uploadDir);

            console.log(`[Job ${jobId}] Transcribing...`);
            const transcript = await transcribeAudio(localAudioPath);

            // Cleanup local audio
            if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);

            jobs[jobId] = {
                status: 'completed',
                videoUrl: videoUrl,
                transcript: transcript,
                completedAt: new Date()
            };
            console.log(`[Job ${jobId}] Finished.`);
        } catch (error) {
            console.error(`[Job ${jobId}] Error:`, error);
            if (localAudioPath && fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
            jobs[jobId] = {
                status: 'error',
                message: error.message
            };
        }
    })();

    // Respond immediately with jobId
    res.json({ jobId });
});

// 3. Analyze Audio File (Multer Fallback)
app.post('/api/analyze-audio', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No audio file provided' });
    const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const localAudioPath = req.file.path;
    jobs[jobId] = { status: 'processing', progress: 0 };
    const duration = req.headers['x-video-duration'];
    (async () => {
        try {
            const transcript = await transcribeAudio(localAudioPath, duration, (msg) => {
                jobs[jobId] = { ...jobs[jobId], message: msg };
            });
            if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
            jobs[jobId] = { status: 'completed', transcript: transcript, completedAt: new Date() };
        } catch (error) {
            console.error(`[Job ${jobId}] Error:`, error);
            if (fs.existsSync(localAudioPath)) fs.unlinkSync(localAudioPath);
            jobs[jobId] = { status: 'error', message: error.message };
        }
    })();
    res.json({ jobId });
});


// 3.5 Analyze Audio URL (Cloud-Native Handover - ELITE)
app.post('/api/analyze-audio-url', async (req, res) => {
    const { audioUrl, duration } = req.body;
    if (!audioUrl) return res.status(400).json({ message: 'No audio URL provided' });

    const jobId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    jobs[jobId] = { status: 'processing', progress: 0, audioUrl };

    (async () => {
        try {
            console.log(`[Job ${jobId}] Starting Cloud-Native Analysis:`, audioUrl, 'Duration:', duration);
            const transcript = await transcribeAudio(audioUrl, duration, (msg) => {
                jobs[jobId] = { ...jobs[jobId], message: msg };
            });
            jobs[jobId] = { status: 'completed', transcript: transcript, completedAt: new Date() };
            console.log(`[Job ${jobId}] Analysis Successful.`);
        } catch (error) {
            console.error(`[Job ${jobId}] Analysis Failure:`, error);
            jobs[jobId] = { status: 'error', message: error.message };
        }
    })();

    res.json({ jobId });
});

// 4. Check Job Status (Polling Endpoint)
app.get('/api/job-status/:id', (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(job);
});

// 4. Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage() });
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

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// 5. Gumroad Webhook (Secured)
app.post('/api/webhooks/gumroad', async (req, res) => {
    try {
        const { email, sale_id, product_id, refunded, subscription_id, resource_name } = req.body;

        console.log('[Webhook] Gumroad Ping received:', { email, resource_name, sale_id });

        if (!email) {
            return res.status(400).send('Bad Request');
        }

        // Security: Verify sale with Gumroad API
        const isTest = req.body.test === 'true' || req.body.test === true;
        const GUMROAD_TOKEN = process.env.GUMROAD_ACCESS_TOKEN;

        if (!isTest && GUMROAD_TOKEN && sale_id) {
            try {
                const verification = await axios.get(
                    `https://api.gumroad.com/v2/sales/${sale_id}`,
                    { params: { access_token: GUMROAD_TOKEN } }
                );
                if (!verification.data.success) {
                    console.error('[Webhook] Sale verification FAILED for:', sale_id);
                    return res.status(403).send('Verification failed');
                }
                console.log('[Webhook] Sale verified with Gumroad API ✓');
            } catch (verifyErr) {
                console.warn('[Webhook] Could not verify sale (non-blocking):', verifyErr.message);
            }
        } else if (isTest) {
            console.log('[Webhook] Test sale detected - bypassing external verification ✓');
        }

        // Supabase Admin Client
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

        const shouldBePro = !(refunded === 'true' || resource_name === 'subscription_ended' || resource_name === 'subscription_cancelled');
        const userEmail = email.trim().toLowerCase();

        // 1. Resolve UUID from Auth Users
        let resolvedId = null;
        try {
            const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
            if (!authError) {
                const targetUser = users.find(u => u.email?.toLowerCase().trim() === userEmail);
                if (targetUser) resolvedId = targetUser.id;
            }
        } catch (authErr) {
            console.warn('[Webhook] Auth lookup failed:', authErr.message);
        }

        // 2. Robust Update/Insert logic
        const updatePayload = {
            is_pro: shouldBePro,
            gumroad_id: subscription_id || sale_id,
            updated_at: new Date().toISOString()
        };

        if (resolvedId) {
            // Priority 1: Match by ID (UUID)
            const { error: idError } = await supabaseAdmin
                .from('profiles')
                .upsert({ id: resolvedId, email: userEmail, ...updatePayload });

            if (idError) console.error('[Webhook] Update by ID failed:', idError.message);
            else console.log(`[Webhook] Success: Upgraded user by ID (${resolvedId}) ✓`);
        } else {
            // Priority 2: Match by Email (Fallback)
            const { data: existing } = await supabaseAdmin.from('profiles').select('id').ilike('email', userEmail).single();
            if (existing) {
                await supabaseAdmin.from('profiles').update(updatePayload).eq('id', existing.id);
                console.log(`[Webhook] Success: Upgraded existing email profile ✓`);
            } else {
                await supabaseAdmin.from('profiles').insert({ email: userEmail, ...updatePayload });
                console.log(`[Webhook] Success: Created new pro profile for ${userEmail} ✓`);
            }
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('[Webhook] Fatal:', err.message);
        res.status(500).send('Error');
    }
});

app.get('/', (req, res) => {
    res.send('ClipSense API is running...');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
