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
  Moon,
  Sun,
  ChevronRight,
  Zap,
  Music
} from 'lucide-react';
import logo from './assets/vidsift-final__1_-removebg-preview.png';
import './index.css';


function App() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isClipping, setIsClipping] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [serverHealth, setServerHealth] = useState('checking'); // 'online' | 'offline' | 'checking'

  const ffmpegRef = useRef(new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  // Initialize FFmpeg
  useEffect(() => {
    const load = async () => {
      try {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
          console.log('[FFMPEG]', message);
        });
        ffmpeg.on('progress', ({ progress }) => {
          setExtractionProgress(Math.round(progress * 100));
        });
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setFfmpegLoaded(true);
        console.log('FFmpeg wasm loaded successfully.');
      } catch (err) {
        console.error('Failed to load FFmpeg wasm:', err);
        setError('Your browser might not support local extraction. Please use Chrome/Edge.');
      }
    };
    load();
  }, []);
  // Protocol-aware API URL Resolution
  const getBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL;
    const isProduction = window.location.hostname !== 'localhost';

    if (envUrl) {
      const formattedUrl = (window.location.protocol === 'https:' && envUrl.startsWith('http:'))
        ? envUrl.replace('http:', 'https:')
        : envUrl;
      console.log('Backend Bridge:', formattedUrl);
      return formattedUrl;
    }

    if (isProduction) {
      console.error('CRITICAL: VITE_API_URL is missing in deployment environment variables!');
      return 'https://error-missing-api-url.com'; // Trigger a more obvious failing URL
    }

    return 'http://localhost:5000';
  };

  const API_URL = getBaseUrl();

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Server Health Monitoring
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_URL}/api/health`);
        if (res.ok) setServerHealth('online');
        else setServerHealth('offline');
      } catch {
        setServerHealth('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [API_URL]);
  const formatTime = (time) => {
    if (typeof time === 'string') return time;
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const filteredTranscript = transcript
    ? transcript.filter(item => item.text.toLowerCase().includes(searchTerm.toLowerCase()))
    : null;

  const handleJumpToTime = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const handleDownloadClip = async (start, end) => {
    if (!videoUrl || !file || !ffmpegLoaded) return;

    // Correctly handle missing end time
    const startTime = parseFloat(start);
    const endTime = (end && !isNaN(end)) ? parseFloat(end) : (startTime + 5);

    setIsUploading(true);
    setIsExtracting(true);
    setExtractionProgress(0);
    setError(null);

    const ffmpeg = ffmpegRef.current;
    const fileExt = file.name.split('.').pop();
    const inputName = `input.${fileExt}`;
    const outputName = `clip_${Date.now()}.${fileExt}`;

    try {
      console.log(`Stage 1: Clipping Segment [${startTime}s - ${endTime}s] in Browser...`);

      // Load file into FS if not already there (we can check with listDir but let's just write for safety)
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Fast seek and cut
      await ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', inputName,
        '-to', (endTime - startTime).toString(),
        '-c', 'copy', // Fast copy (no re-encoding)
        outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      const clipBlob = new Blob([data.buffer], { type: `video/${fileExt}` });

      const url = URL.createObjectURL(clipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outputName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('Clip generated and downloaded successfully!');
    } catch (err) {
      console.error('Clipping Error:', err);
      setError(`Failed to generate clip: ${err.message}`);
    } finally {
      setIsUploading(false);
      setIsExtracting(false);
    }
  };

  const handleExportTranscript = () => {
    if (!transcript) return;

    try {
      const doc = new jsPDF();
      const margin = 20;
      let y = 20;

      // Header
      doc.setFontSize(22);
      doc.setTextColor(99, 102, 241);
      doc.text('VidSift AI Report', margin, y);

      y += 10;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
      doc.text(`Source: ${file?.name || 'Local Video'}`, margin, y + 5);

      y += 20;
      doc.setDrawColor(200);
      doc.line(margin, y - 5, 190, y - 5);

      // Content
      doc.setFontSize(12);
      doc.setTextColor(0);

      transcript.forEach((item, index) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(99, 102, 241);
        doc.text(`[${formatTime(item.time)}]`, margin, y);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40);

        const splitText = doc.splitTextToSize(item.text, 150);
        doc.text(splitText, margin + 25, y);

        y += (splitText.length * 7) + 5;
      });

      doc.save(`VidSift_Report_${Date.now()}.pdf`);
    } catch (err) {
      console.error('PDF Export Error:', err);
      setError('Failed to generate PDF. Please try again.');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setVideoUrl(URL.createObjectURL(selectedFile)); // Local playback via Blob URL
      setError(null);
      setTranscript(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!ffmpegLoaded) {
      setError("Local Intelligence Studio is still warming up... please wait 5 seconds and try again.");
      return;
    }

    setIsUploading(true);
    setIsExtracting(true);
    setExtractionProgress(0);
    setError(null);

    const ffmpeg = ffmpegRef.current;
    const fileExt = file.name.split('.').pop();
    const inputName = `input.${fileExt}`;
    const outputName = 'output.mp3';

    try {
      console.log('Stage 1: Extracting Audio in Browser...');
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Extract audio: 16kHz, mono, MP3 at 32kbps for maximum length support (500MB+ videos)
      await ffmpeg.exec([
        '-i', inputName,
        '-ar', '16000',
        '-ac', '1',
        '-b:a', '32k',
        '-vn',
        outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
      setIsExtracting(false);

      console.log('Stage 2: Uploading small audio track to Backend...');
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.mp3');

      const analyzeResponse = await fetch(`${API_URL}/api/analyze-audio`, {
        method: 'POST',
        body: formData,
      });

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json().catch(() => ({}));
        throw new Error(errorData.message || `Server analysis error: ${analyzeResponse.status}`);
      }

      const { jobId } = await analyzeResponse.json();
      console.log('Job initiated:', jobId);

      // 3. Poll for results 
      let isCompleted = false;
      while (!isCompleted) {
        console.log(`Polling job status: ${jobId}...`);
        const statusResponse = await fetch(`${API_URL}/api/job-status/${jobId}`);
        if (!statusResponse.ok) throw new Error('Lost connection to analysis worker');

        const job = await statusResponse.json();

        if (job.status === 'completed') {
          console.log('Job finished successfully!');
          setTranscript(job.transcript);
          isCompleted = true;
        } else if (job.status === 'error') {
          throw new Error(job.message || 'Transcription failed unexpectedly');
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }

    } catch (err) {
      console.error('Ultima Fix Error Context:', err);
      let msg = `Processing Failed: ${err.message}`;
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        msg = "Network Error: Could not connect to the server. Check if the backend is online.";
      }
      setError(msg);
    } finally {
      setIsUploading(false);
      setIsExtracting(false);
    }
  };

  return (
    <div className="app-root">
      <div className="bg-mesh"></div>

      {/* Theme Control */}
      <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle Theme">
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className="container">
        <header className="header reveal">
          <div className="logo-section">
            <img src={logo} alt="VidSift Logo" className="logo-img" />
            <h1 className="logo-text">VidSift</h1>
          </div>
          <p className="tagline" style={{ fontFamily: 'Inter', fontWeight: 300, fontSize: '0.9rem', letterSpacing: '0.05em', opacity: 0.5 }}>
            PROFESSIONAL AUDIO-TO-SCRIPT WORKFLOW
          </p>
          <div className={`status-badge ${serverHealth}`} style={{ marginTop: '2rem' }}>
            <span className="status-dot"></span>
            {serverHealth.toUpperCase()}
          </div>
        </header>

        {error && (
          <div className="error-message reveal">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        <main className="dashboard-layout">
          {/* Analysis View */}
          <div className="main-col reveal delay-1">
            <div className="designer-card">
              <span className="card-label">MASTER MONITOR</span>

              {(!videoUrl || (file && !transcript && !isUploading)) && (
                <div
                  className={`refined-dropzone ${file ? 'has-file' : ''}`}
                  onClick={() => !isUploading && fileInputRef.current.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="video/*"
                    hidden
                  />
                  <div className="upload-icon-wrapper">
                    <Upload size={32} />
                  </div>
                  <h3>{file ? file.name : "Import your video"}</h3>
                  {file && !isUploading && (
                    <button
                      className={`action-btn reveal ${!ffmpegLoaded ? 'loading' : ''}`}
                      disabled={!ffmpegLoaded}
                      style={{
                        marginTop: '1.5rem',
                        background: !ffmpegLoaded ? '#444' : 'linear-gradient(135deg, #6366f1, #a855f7)',
                        cursor: !ffmpegLoaded ? 'wait' : 'pointer'
                      }}
                      onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                    >
                      {ffmpegLoaded ? <><Zap size={18} /> Start Deep Analysis</> : <><Loader2 size={18} className="spin" /> Warming up Studio...</>}
                    </button>
                  )}
                </div>
              )}

              {videoUrl && !isUploading && (
                <div className="refined-video-container reveal">
                  <video
                    ref={videoRef}
                    src={videoUrl.startsWith('blob:') || videoUrl.startsWith('http') ? videoUrl : `${API_URL}${videoUrl}`}
                    controls
                  />
                </div>
              )}

              {isUploading && (
                <div className="loading-designer">
                  <Loader2 size={48} className="spin" style={{ color: 'var(--primary)' }} />
                  <div className="loader-bar">
                    <div className="loader-progress"></div>
                  </div>
                  <h3>{isExtracting ? "Extracting Audio Studio" : isClipping ? "Clipping Video Segment" : "AI Intelligence at Work"}</h3>
                  <p style={{ color: 'var(--text-muted)' }}>
                    {isExtracting ? "Stripping high-fidelity audio locally..." :
                      isClipping ? "Building your custom video highlight..." :
                        "Analyzing audio segments & generating transcript..."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Insights View */}
          <div className="side-col reveal delay-2">
            <div className="designer-card">
              <span className="card-label">SCRIPT TIMELINE</span>

              <div className="refined-transcript-area">
                {transcript ? (
                  <>
                    <div className="transcript-header-actions">
                      <div className="search-input-wrapper">
                        <input
                          className="search-field"
                          type="text"
                          placeholder="Search within content..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <button className="export-btn" onClick={handleExportTranscript}>
                        <Download size={16} /> Export Report
                      </button>
                    </div>
                    <div className="refined-transcript-list">
                      {filteredTranscript.map((item, index) => (
                        <div
                          key={index}
                          className="refined-transcript-item"
                          onClick={() => handleJumpToTime(item.time)}
                        >
                          <div className="item-content">
                            <span className="item-time">{formatTime(item.time)}</span>
                            <p className="item-text">{item.text}</p>
                          </div>
                          <button
                            className="extract-btn"
                            title="Export Segment"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadClip(item.time, item.time_end);
                            }}
                          >
                            <Scissors size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '4rem 0', textAlign: 'center', opacity: 0.5 }}>
                    <FileText size={48} style={{ marginBottom: '1rem' }} />
                    <p>Analysis insights will be generated here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default App;
