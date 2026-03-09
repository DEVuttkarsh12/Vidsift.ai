import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
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
  Zap
} from 'lucide-react';
import logo from './assets/vidsift-final__1_-removebg-preview.png';
import './index.css';


function App() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };
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

  const handleDownloadClip = (start, end) => {
    if (!videoUrl) return;
    // Ensure end is a valid number, otherwise default to start + 5 seconds
    const endTime = (end && !isNaN(end)) ? end : (parseFloat(start) + 5);
    const downloadUrl = `${API_URL}/api/download-clip?videoUrl=${encodeURIComponent(videoUrl)}&start=${start}&end=${endTime}`;
    window.location.href = downloadUrl;
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
      doc.text('ClipSense AI Report', margin, y);

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

      doc.save(`ClipSense_Report_${Date.now()}.pdf`);
    } catch (err) {
      console.error('PDF Export Error:', err);
      setError('Failed to generate PDF. Please try again.');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      // 1. Get Signed Upload Signature from our backend
      const sigResponse = await fetch(`${API_URL}/api/generate-signature`);
      if (!sigResponse.ok) throw new Error('Failed to get upload authorization');
      const sigData = await sigResponse.json();

      // 2. Upload directly to Cloudinary (Bypasses Railway 100MB limit)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', sigData.signature);
      formData.append('timestamp', sigData.timestamp);
      formData.append('api_key', sigData.api_key);
      formData.append('folder', sigData.folder);

      const cloudResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${sigData.cloud_name}/video/upload`,
        { method: 'POST', body: formData }
      );

      if (!cloudResponse.ok) {
        const cloudError = await cloudResponse.json();
        throw new Error(`Cloudinary Error: ${cloudError.error?.message || 'Cloud upload failed'}`);
      }

      const cloudData = await cloudResponse.json();
      const videoUrl = cloudData.secure_url;

      // 3. Send the Cloudinary URL to our backend for local transcription
      const analyzeResponse = await fetch(`${API_URL}/api/analyze-cloudinary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl }),
      });

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json().catch(() => ({}));
        throw new Error(errorData.message || 'Server analysis failed.');
      }

      const data = await analyzeResponse.json();
      setVideoUrl(data.videoUrl);
      setTranscript(data.transcript);

    } catch (err) {
      console.error('Upload Error:', err);
      setError(`Upload Failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="app-root">
      {/* Dynamic Background Elements */}
      <div className="bg-mesh">
      </div>

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
          <p className="tagline">Local AI intelligence for your video archive. Extract moments that matter without sending data to the cloud.</p>
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
              <span className="card-label">Media Source</span>

              {!videoUrl && !isUploading ? (
                <div
                  className="refined-dropzone"
                  onClick={() => fileInputRef.current.click()}
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
                  <p style={{ color: 'var(--text-muted)' }}>Drag and drop or click to browse</p>

                  {file && (
                    <button
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                    >
                      Start Analysis <ChevronRight size={18} />
                    </button>
                  )}
                </div>
              ) : isUploading ? (
                <div className="loading-designer">
                  <Loader2 size={48} className="spin" style={{ color: 'var(--primary)' }} />
                  <div className="loader-bar">
                    <div className="loader-progress"></div>
                  </div>
                  <h3>Processing Analysis</h3>
                  <p style={{ color: 'var(--text-muted)' }}>Extracting high-fidelity audio & running local Whisper engine...</p>
                </div>
              ) : (
                <div className="refined-video-container">
                  <video ref={videoRef} src={videoUrl.startsWith('http') ? videoUrl : `${API_URL}${videoUrl}`} controls autoPlay />
                </div>
              )}
            </div>
          </div>

          {/* Insights View */}
          <div className="side-col reveal delay-2">
            <div className="designer-card">
              <span className="card-label">Intelligence Report</span>

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
