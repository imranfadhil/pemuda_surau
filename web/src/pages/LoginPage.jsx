import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { SURAU } from '../lib/constants.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [channel, setChannel] = useState('');
  const [needsAdminHelp, setNeedsAdminHelp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.requestOtp(phone);
      if (res.devCode) setDevCode(res.devCode);
      setChannel(res.channel || '');
      setNeedsAdminHelp(Boolean(res.needsAdminHelp));
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.verifyOtp(phone, code);
      login(res.token, res.user);
      navigate(res.needsProfile ? '/register' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">🕌</div>
        <h1 className="center" style={{ margin: '0 0 4px', fontSize: '1.4rem' }}>
          {SURAU.name}
        </h1>
        <p className="center muted" style={{ marginBottom: 24 }}>
          Track your daily prayers
        </p>

        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          <div>📍 {SURAU.address}</div>
          <a
            href={SURAU.mapsUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 6 }}
          >
            {SURAU.latitude}° N, {SURAU.longitude}° E — Open in Maps
          </a>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {step === 'phone' ? (
          <form onSubmit={requestOtp}>
            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                placeholder="+60123456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button className="btn btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <div className="field">
              <label htmlFor="code">Verification code</label>
              <input
                id="code"
                inputMode="numeric"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                required
                autoFocus
              />
            </div>
            {devCode && (
              <div className="alert alert-info">
                Dev mode — your code is <strong>{devCode}</strong>
              </div>
            )}
            {!devCode && channel === 'telegram' && (
              <div className="alert alert-info">
                We sent your code to your linked <strong>Telegram</strong> account.
              </div>
            )}
            {!devCode && channel === 'sms' && (
              <div className="alert alert-info">
                We sent your code by <strong>SMS</strong>.
              </div>
            )}
            {needsAdminHelp && (
              <div className="alert alert-info">
                We couldn't reach you automatically. Please ask a surau admin to generate a
                login code for you.
              </div>
            )}
            <button className="btn btn-block" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              style={{ marginTop: 10 }}
              onClick={() => {
                setStep('phone');
                setCode('');
                setDevCode('');
                setChannel('');
                setNeedsAdminHelp(false);
              }}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}