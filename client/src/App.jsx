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
import AuthModal from './AuthModal';
import { supabase } from './supabaseClient';

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
  const [studioStatus, setStudioStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeClip, setActiveClip] = useState(null);
  
  // Auth state
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

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

    // Check active session & subscribe to auth changes
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setShowAuthModal(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
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

  const handleJumpToTime = (time, shouldPlay = true) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      if (shouldPlay) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
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
      setStudioStatus('Mounting Studio Assets...');

      // WorkerFS Mounting: Memory-efficient way to handle 2GB+ files
      // Instead of reading the whole blob into RAM, we mount it as a virtual drive
      const folder = '/work';
      try {
        await ffmpeg.createDir(folder);
      } catch (e) {
        // Directory may already exist from previous session
      }

      await ffmpeg.mount('WORKERFS', {
        files: [file],
      }, folder);

      setStudioStatus('Scrubbing Studio Audio...');

      // Update extraction progress listener
      const progressHandler = ({ progress }) => {
        setExtractionProgress(Math.round(progress * 100));
      };
      ffmpeg.on('progress', progressHandler);

      await ffmpeg.exec([
        '-i', `${folder}/${file.name}`,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '12k',
        '-f', 'mp3',
        'audio.mp3'
      ]);

      setStudioStatus('Reading Extractions...');
      const audioData = await ffmpeg.readFile('audio.mp3');
      const audioBlob = new Blob([audioData.buffer], { type: 'audio/mp3' });

      // Cleanup mount
      try {
        await ffmpeg.unmount(folder);
      } catch (e) {
        console.warn('[Studio] Unmount failed (may not be critical):', e);
      }
      console.log(`[Studio] Extracted Audio Size: ${(audioBlob.size / 1024 / 1024).toFixed(2)}MB`);

      if (audioBlob.size > 24 * 1024 * 1024) {
        throw new Error('Project audio is too large for cloud analysis (Limit: 25MB). Try a shorter video.');
      }

      setIsExtracting(false);
      setStudioStatus('Generating Secure Handshake...');

      // Cloud-Native Handover: Upload audio to Cloudinary first
      const sigRes = await fetch(`${API_URL}/api/generate-signature`);
      const sigData = await sigRes.json();

      setStudioStatus('Buffering to Cloud (0%)');

      // Manual XHR for upload progress tracking
      const audioUrl = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${sigData.cloud_name}/auto/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percent);
            setStudioStatus(`Buffering to Cloud (${percent}%)`);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const res = JSON.parse(xhr.responseText);
            resolve(res.secure_url);
          } else {
            reject(new Error('Cloud buffering failed.'));
          }
        };

        xhr.onerror = () => reject(new Error('Cloud connection error.'));

        const cloudFormData = new FormData();
        cloudFormData.append('file', audioBlob);
        cloudFormData.append('api_key', sigData.api_key);
        cloudFormData.append('timestamp', sigData.timestamp);
        cloudFormData.append('signature', sigData.signature);
        cloudFormData.append('folder', sigData.folder);
        xhr.send(cloudFormData);
      });
      // Ensure duration is captured precisely (Prefer state, fallback to ref)
      const duration = videoDuration || (videoRef.current ? videoRef.current.duration : 0);

      if (!duration || duration <= 0) {
        console.warn('[Studio] Critical: No video duration detected.');
      }

      setStudioStatus('Initializing Deep Analysis...');
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
        } else if (job.status === 'processing') {
          // Update status with granular backend feedback if available
          setStudioStatus(job.message || 'Analyzing Intelligence...');
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

    if (!user) {
      setPendingAction(() => () => triggerExportTranscript());
      setShowAuthModal(true);
      return;
    }

    triggerExportTranscript();
  };

  const triggerExportTranscript = () => {
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

  const handleDownloadClip = (start, end) => {
    if (!user) {
      setPendingAction(() => () => triggerDownloadClip(start, end));
      setShowAuthModal(true);
      return;
    }
    triggerDownloadClip(start, end);
  };

  const triggerDownloadClip = async (start, end) => {
    if (!file) return;
    setIsClipping(true);
    try {
      const ffmpeg = ffmpegRef.current;
      const duration = end - start;
      const folder = '/work_clip';

      try {
        await ffmpeg.createDir(folder);
      } catch (e) { }

      // WorkerFS for clips: Memory-efficient for massive source videos
      await ffmpeg.mount('WORKERFS', {
        files: [file],
      }, folder);

      await ffmpeg.exec([
        '-ss', start.toString(),
        '-i', `${folder}/${file.name}`,
        '-t', duration.toString(),
        '-c', 'copy',
        'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      // Early cleanup
      await ffmpeg.unmount(folder);

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

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => {
          setShowAuthModal(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setShowAuthModal(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
      />

      <div className="container">
        {/* Elite Header */}
        <header className="studio-header reveal" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="logo-text-elite">VidSift</h1>
            <p className="tagline-elite">Find any moment inside your video instantly</p>
          </div>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontFamily: 'Inter' }}>{user.email}</span>
              <button 
                className="btn-skip" 
                onClick={() => supabase.auth.signOut()}
              >
                Log Out
              </button>
            </div>
          ) : (
            <button 
              className="btn-skip" 
              onClick={() => setShowAuthModal(true)}
            >
              Sign In
            </button>
          )}
        </header>

        {/* Upload Interstitial REMOVED - Integrated into workspace */}

        {/* Global Loading Layer */}
        {isUploading && (
          <div className="upload-modal reveal">
            <div className="elite-panel upload-card-elite" style={{ border: 'none', background: 'transparent' }}>
              <Loader2 size={64} className="spin" style={{ color: 'var(--accent)', marginBottom: '2rem' }} />
              <h2 style={{ fontFamily: 'Fraunces', fontSize: '2rem' }}>
                {studioStatus}
              </h2>
              {isExtracting && (
                <div className="progress-container-elite">
                  <div className="progress-bar-elite" style={{ width: `${extractionProgress}%` }}></div>
                  <span className="progress-label-elite">{extractionProgress}%</span>
                </div>
              )}
              {uploadProgress > 0 && !isExtracting && (
                <div className="progress-container-elite">
                  <div className="progress-bar-elite" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', marginTop: '1.5rem', letterSpacing: '0.1em', fontSize: '0.8rem' }}>
                {isExtracting ? 'SCRUBBING STUDIO MASTER' : 'PROCESSING GLOBAL ASSETS'}
              </p>
            </div>
          </div>
        )}

        {/* Workspace Layer */}
        {!isUploading && (
          <div className="workspace-grid reveal delay-1">
            {/* Monitor */}
            <div className="elite-panel monitor-panel">
              <span className="segment-meta">Your Video</span>
              <div 
                className="monitor-frame" 
                style={!file ? { display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'rgba(0,0,0,0.5)', cursor: 'pointer' } : {}}
                onClick={() => !file && fileInputRef.current?.click()}
              >
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    onLoadedMetadata={(e) => setVideoDuration(e.target.duration)}
                    controls
                  />
                ) : (
                  <>
                    <Upload size={48} className="upload-icon-elite" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }} />
                    <h2 style={{ fontFamily: 'Fraunces', color: 'var(--text-main)', fontSize: '1.5rem', margin: 0 }}>Start New Project</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>Import high-fidelity video files for deep AI analysis.</p>
                    <button className="btn-primary-elite" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Select Video</button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" hidden />
                  </>
                )}
              </div>
              <div style={{ marginTop: '2rem' }}>
                <h3 style={{ fontFamily: 'Fraunces', fontSize: '1.5rem' }}>Current Clip</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {file ? 'Watch your video and fine-tune your clips.' : 'Upload a video to start editing.'}
                </p>
                
                {file && !transcript && !isUploading && (
                  <button className="btn-primary-elite" onClick={handleUpload} style={{ width: '100%', marginTop: '1.5rem' }}>
                    <Zap size={16} /> <span style={{ marginLeft: '8px' }}>Analyze Studio</span>
                  </button>
                )}
                
                {activeClip && (
                  <div className="clip-editor-panel reveal">
                    <div className="clip-editor-header">
                      <div>
                        <span className="segment-meta" style={{ marginBottom: '0.2rem', color: 'var(--text-main)' }}>The Cutting Room</span>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'Inter' }}>Fine-tune your extraction length</p>
                      </div>
                      <button 
                        className="btn-cut-action" 
                        onClick={() => handleDownloadClip(activeClip.start, activeClip.end)}
                        disabled={isClipping}
                      >
                        {isClipping ? <Loader2 size={16} className="spin" /> : <Scissors size={16} />}
                        {isClipping ? 'CUTTING...' : 'EXTRACT CLIP'}
                      </button>
                    </div>
                    
                    <div className="clip-controls">
                      <div className="clip-stat-box">
                        <span className="stat-label">START (LOCKED)</span>
                        <span className="stat-value">{formatTime(activeClip.start)}</span>
                      </div>
                      
                      <div className="slider-container">
                        <div className="slider-labels">
                          <span className="stat-label">DURATION</span>
                          <span className="stat-value highlight">{Math.max(0.5, activeClip.end - activeClip.start).toFixed(1)}s</span>
                        </div>
                        <input 
                          type="range" 
                          min="0.5" 
                          max="60" 
                          step="0.5" 
                          value={Math.min(60, Math.max(0.5, activeClip.end - activeClip.start))}
                          onChange={(e) => {
                            const duration = parseFloat(e.target.value);
                            const newEnd = activeClip.start + duration;
                            if (newEnd <= (activeClip.maxDuration || videoDuration)) {
                              setActiveClip({ ...activeClip, end: newEnd });
                              handleJumpToTime(newEnd, false);
                            }
                          }}
                          className="elite-duration-slider"
                        />
                      </div>

                      <div className="clip-stat-box">
                        <span className="stat-label">END POINT</span>
                        <span className="stat-value">{formatTime(activeClip.end)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Script Timeline */}
            <div className="elite-panel timeline-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <span className="segment-meta" style={{ marginBottom: 0 }}>Video Script</span>
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
                    placeholder="Search video script..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div className="search-key-hint">CMD+F</div>
                </div>
              </div>
              <div className="timeline-scroll">
                {!file ? (
                   <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '1rem', opacity: 0.5, padding: '4rem 0' }}>
                     <Music size={48} />
                     <p style={{ fontFamily: 'Inter', fontSize: '0.9rem' }}>Awaiting video source...</p>
                   </div>
                ) : !transcript ? (
                   <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '1rem', opacity: 0.5, padding: '4rem 0' }}>
                     <Zap size={48} />
                     <p style={{ fontFamily: 'Inter', fontSize: '0.9rem' }}>Ready for AI Analysis</p>
                   </div>
                ) : (
                  filteredTranscript.map((item, index) => (
                    <div key={index} className="script-segment" onClick={() => handleJumpToTime(item.time, false)}>
                      <span className="segment-meta">TC: {formatTime(item.time)}</span>
                      <p className="segment-text">{item.text}</p>
                      <div className="segment-actions">
                        <button 
                          className={`btn-mini ${activeClip?.originalTime === item.time ? 'active-scissor' : ''}`} 
                           onClick={(e) => { 
                            e.stopPropagation(); 
                            setActiveClip({ 
                              start: item.time, 
                              end: item.time_end || (item.time + 3), 
                              maxDuration: videoDuration,
                              originalTime: item.time 
                            });
                            handleJumpToTime(item.time, false);
                          }}
                          title="Load into Cutting Room"
                        >
                          <Scissors size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
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
