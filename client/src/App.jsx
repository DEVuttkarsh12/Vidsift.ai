import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  Upload,
  Play,
  FileText,
  Loader2,
  Video as VideoIcon,
  Download,
  Search,
  CheckCircle2,
  AlertCircle,
  Scissors,
  Zap,
  Music,
  Maximize2
} from 'lucide-react';
import logo from './assets/vidsift-final__1_-removebg-preview.png';
import './index.css';

function App() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isClipping, setIsClipping] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [serverHealth, setServerHealth] = useState('checking');

  const ffmpegRef = useRef(new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);
  const fileInputRef = useRef(null);

  // Initialize FFmpeg
  useEffect(() => {
    const load = async () => {
      try {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        const ffmpeg = ffmpegRef.current;
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setFfmpegLoaded(true);
      } catch (err) {
        setError('Studio services failed to initialize. Please use Chrome.');
      }
    };
    load();
  }, []);

  const getBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL;
    if (envUrl) return envUrl;
    return window.location.hostname !== 'localhost' ? 'https://error-missing-api-url.com' : 'http://localhost:5000';
  };
  const API_URL = getBaseUrl();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setVideoUrl(URL.createObjectURL(selectedFile));
      setError(null);
    }
  };

  const handleJumpToTime = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleUpload = async () => {
    if (!file || !ffmpegLoaded) return;
    setIsUploading(true);
    setIsExtracting(true);
    setError(null);

    try {
      const ffmpeg = ffmpegRef.current;
      
      // Stable approach: writeFile (standard for v0.12.x)
      // We use fetchFile which handles the blob conversion elegantly
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      
      await ffmpeg.exec([
        '-i', 'input.mp4', 
        '-vn', 
        '-ac', '1', 
        '-ar', '16000', 
        '-b:a', '12k', 
        '-f', 'mp3', 
        'audio.mp3'
      ]);
      
      const audioData = await ffmpeg.readFile('audio.mp3');
      const audioBlob = new Blob([audioData.buffer], { type: 'audio/mp3' });
      console.log(`[Studio] Extracted Audio Size: ${(audioBlob.size / 1024 / 1024).toFixed(2)}MB`);

      if (audioBlob.size > 24 * 1024 * 1024) {
        throw new Error('Project audio is too large for cloud analysis (Limit: 25MB). Try a shorter video.');
      }

      setIsExtracting(false);

      // Cloud-Native Handover: Upload audio to Cloudinary first
      // This bypasses server connection timeouts for large files
      const sigRes = await fetch(`${API_URL}/api/generate-signature`);
      const sigData = await sigRes.json();

      const cloudFormData = new FormData();
      cloudFormData.append('file', audioBlob);
      cloudFormData.append('api_key', sigData.api_key);
      cloudFormData.append('timestamp', sigData.timestamp);
      cloudFormData.append('signature', sigData.signature);
      cloudFormData.append('folder', sigData.folder);

      const cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sigData.cloud_name}/auto/upload`,
        { method: 'POST', body: cloudFormData }
      );

      if (!cloudRes.ok) throw new Error('Cloud Storage Handover failed.');
      const cloudData = await cloudRes.json();
      // Ensure duration is captured precisely (Prefer state, fallback to ref)
      const duration = videoDuration || (videoRef.current ? videoRef.current.duration : 0);
      
      if (!duration || duration <= 0) {
        console.warn('[Studio] Critical: No video duration detected.');
      }

      const response = await fetch(`${API_URL}/api/analyze-audio-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl, duration })
      });

      if (!response.ok) throw new Error('Studio analysis request failed.');
      const { jobId } = await response.json();

      // Poll for job completion
      let completed = false;
      while (!completed) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${API_URL}/api/job-status/${jobId}`);
        const job = await statusRes.json();

        if (job.status === 'completed') {
          setTranscript(job.transcript);
          completed = true;
        } else if (job.status === 'error') {
          throw new Error(job.message || 'Analysis failed.');
        }
      }
    } catch (err) {
      console.error('Studio Analysis Failure:', err);
      const errorMessage = typeof err === 'string' ? err : (err?.message || 'Unknown Cinematic Error');
      setError(`Studio Analysis Error: ${errorMessage}`);
    } finally {
      setIsUploading(false);
      setIsExtracting(false);
    }
  };

  const handleExportTranscript = () => {
    if (!transcript) return;
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("VidSift Intelligence Report", 20, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Source Name: ${file?.name || 'Uploaded Video'}`, 20, 30);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 38);

    let y = 50;
    transcript.forEach((item, index) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(`[${formatTime(item.time)}]`, 20, y);
      doc.setFont("helvetica", "normal");
      const splitText = doc.splitTextToSize(item.text, 150);
      doc.text(splitText, 45, y);
      y += (splitText.length * 7) + 5;
    });

    doc.save(`VidSift_Report_${file?.name || 'export'}.pdf`);
  };

  const handleDownloadClip = async (start, end) => {
    if (!file) return;
    setIsClipping(true);
    try {
      const ffmpeg = ffmpegRef.current;
      const duration = end - start;
      
      // Stable approach for clipping
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));

      await ffmpeg.exec([
        '-ss', start.toString(),
        '-i', 'input.mp4',
        '-t', duration.toString(),
        '-c', 'copy',
        'output.mp4'
      ]);
      const data = await ffmpeg.readFile('output.mp4');
      const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip_${Math.floor(start)}.mp4`;
      a.click();
    } catch (err) {
      setError('Clipping error.');
    } finally {
      setIsClipping(false);
    }
  };

  const filteredTranscript = transcript?.filter(item =>
    item.text.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="app-root">
      {/* Background Cinematic Layer */}
      <div className="cinematic-universe">
        {videoUrl && (
          <video
            ref={bgVideoRef}
            src={videoUrl}
            className="cinematic-bg-video"
            muted
            autoPlay
            loop
          />
        )}
      </div>

      <div className="container">
        {/* Elite Header */}
        <header className="studio-header reveal">
          <h1 className="logo-text-elite">VidSift</h1>
          <p className="tagline-elite">Professional Audio-To-Script Workflow</p>
        </header>

        {/* Upload Interstitial */}
        {!transcript && !isUploading && (
          <div className="upload-modal reveal delay-1">
            <div className="elite-panel upload-card-elite">
              <Upload size={48} className="upload-icon-elite" />
              <h2 className="upload-title-elite">
                {file ? file.name : 'Start New Project'}
              </h2>
              <p className="upload-subtitle-elite">
                Import high-fidelity video files for deep AI analysis.
              </p>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" hidden />
              <div className="upload-actions-elite">
                <button className="btn-primary-elite" onClick={() => fileInputRef.current.click()}>
                  {file ? 'Change Source' : 'Select Video'}
                </button>
                {file && (
                  <button className="btn-primary-elite" onClick={handleUpload}>
                    Analyze Studio
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Global Loading Layer */}
        {isUploading && (
          <div className="upload-modal reveal">
            <div className="elite-panel upload-card-elite" style={{ border: 'none', background: 'transparent' }}>
              <Loader2 size={64} className="spin" style={{ color: 'var(--accent)', marginBottom: '2rem' }} />
              <h2 style={{ fontFamily: 'Fraunces', fontSize: '2rem' }}>
                {isExtracting ? 'Stripping High-Fidelity Audio' : 'AI Intelligence Processing'}
              </h2>
              <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
                Processing your studio-grade assets...
              </p>
            </div>
          </div>
        )}

        {/* Workspace Layer */}
        {transcript && (
          <div className="workspace-grid reveal delay-1">
            {/* Monitor */}
            <div className="elite-panel monitor-panel">
              <span className="segment-meta">Master Monitor</span>
              <div className="monitor-frame">
                <video ref={videoRef} src={videoUrl} controls />
              </div>
              <div style={{ marginTop: '2rem' }}>
                <h3 style={{ fontFamily: 'Fraunces', fontSize: '1.5rem' }}>Active Scene</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Synchronized playback & precision scrubbing.
                </p>
              </div>
            </div>

            {/* Script Timeline */}
            <div className="elite-panel timeline-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <span className="segment-meta" style={{ marginBottom: 0 }}>Script Timeline</span>
                <button className="export-btn-studio" onClick={handleExportTranscript}>
                  <Download size={14} /> EXPORT REPORT
                </button>
              </div>
              <div className="studio-search-container">
                <div className="studio-search-wrapper">
                  <Search size={18} className="search-icon" />
                  <input
                    className="search-field-elite"
                    type="text"
                    placeholder="Refine segments..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div className="search-key-hint">CMD+F</div>
                </div>
              </div>
              <div className="timeline-scroll">
                {filteredTranscript.map((item, index) => (
                  <div key={index} className="script-segment" onClick={() => handleJumpToTime(item.time)}>
                    <span className="segment-meta">TC: {formatTime(item.time)}</span>
                    <p className="segment-text">{item.text}</p>
                    <div className="segment-actions">
                      <button className="btn-mini" onClick={(e) => { e.stopPropagation(); handleDownloadClip(item.time, item.time_end); }}>
                        <Scissors size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="elite-panel reveal" style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', padding: '1rem 2rem', background: '#991b1b', border: 'none', zIndex: 1000 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <AlertCircle size={18} /> {error}
          </span>
        </div>
      )}

      <style>{`
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default App;
