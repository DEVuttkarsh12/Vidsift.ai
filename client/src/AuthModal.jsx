import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { X, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // Supabase might require email verification, but we'll assume auto-login or simple setup for MVP
      }
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay reveal">
      <div className="auth-modal elite-panel">
        <button className="auth-close" onClick={onClose}><X size={20} /></button>
        
        <div className="auth-header">
          <h2 className="auth-title">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p className="auth-subtitle">
            {isLogin 
              ? 'Log in to save your clips and scripts securely.' 
              : 'Sign up to export your premium video analysis.'}
          </p>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(true); setError(null); }}>Log In</button>
          <button className={`auth-tab ${!isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(false); setError(null); }}>Sign Up</button>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          <div className="input-group">
            <Mail size={16} className="input-icon" />
            <input 
              type="email" 
              placeholder="Email address" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="elite-input"
            />
          </div>
          
          <div className="input-group">
            <Lock size={16} className="input-icon" />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="elite-input"
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary-elite auth-submit-btn" disabled={loading}>
            {loading ? <Loader2 size={18} className="spin" /> : (
              <>
                {isLogin ? 'LOG IN' : 'CREATE ACCOUNT'} <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <button className="btn-skip" onClick={onClose}>Skip for now, continue editing</button>
        </div>
      </div>
    </div>
  );
}
