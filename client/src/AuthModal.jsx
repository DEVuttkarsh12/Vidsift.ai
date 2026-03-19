import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { X, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  if (!isOpen) return null;

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        }
      });

      if (error) throw error;
      setShowConfirmation(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message);
    }
  };

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );

  return (
    <div className="auth-overlay reveal">
      <div className="auth-modal elite-panel">
        <button className="auth-close" onClick={onClose}><X size={20} /></button>

        <div className="auth-header">
          <h2 className="auth-title">
            {showConfirmation ? 'Check Your Email' : 'Welcome Back'}
          </h2>
          <p className="auth-subtitle">
            {showConfirmation
              ? `We've sent a magic link to ${email}. Please check your inbox to log in securely.`
              : 'Sign in to save your clips and access premium analysis.'}
          </p>
        </div>

        {showConfirmation ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="success-pulse" style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
              <Mail size={32} style={{ color: '#22c55e' }} />
            </div>
            <button className="btn-primary-elite" onClick={onClose} style={{ width: '100%' }}>
              GOT IT
            </button>
          </div>
        ) : (
          <>
            <button
              className="btn-primary-elite auth-google-btn"
              onClick={handleGoogleAuth}
              style={{ background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', padding: '1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.3s ease' }}
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="auth-divider" style={{ display: 'flex', alignItems: 'center', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem', margin: '0.5rem 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              <span style={{ padding: '0 1rem' }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
            </div>

            <form onSubmit={handleAuth} className="auth-form">
              <div className="input-group">
                <Mail size={16} className="input-icon" />
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="elite-input"
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="btn-primary-elite auth-submit-btn" disabled={loading}>
                {loading ? <Loader2 size={18} className="spin" /> : (
                  <>
                    SEND MAGIC LINK <ArrowRight size={16} />
                  </>
                )}
              </button>
              
              <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                We'll email you a secure link to log in or sign up instantly.
              </p>
            </form>
          </>
        )}

        <div className="auth-footer">
          <button className="btn-skip" onClick={onClose}>Skip for now, continue editing</button>
        </div>
      </div>
    </div>
  );
}
