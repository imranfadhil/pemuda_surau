import { useEffect, useState } from 'react';
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
  const [telegram, setTelegram] = useState({ available: false, botUrl: null, botUsername: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .loginOptions()
      .then((res) => setTelegram(res.telegram || { available: false }))
      .catch(() => {});
  }, []);

  async function requestOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.requestOtp(phone);
      if (res.devCode) setDevCode(res.devCode);
      setChannel(res.channel || '');
      setNeedsAdminHelp(Boolean(res.needsAdminHelp));
      if (res.telegramAvailable) {
        setTelegram((t) => ({ ...t, available: true, botUrl: res.botUrl || t.botUrl }));
      }
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
      navigate(res.needsProfile ? '/register' : '/home', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const telegramCta = telegram.available && telegram.botUrl && (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="card-title">Sign in with Telegram</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        The fastest way in — open the bot, tap <strong>Share my phone number</strong>, and your
        login code arrives instantly. No SMS charges.
      </p>
      <a
        className="btn btn-block"
        style={{ display: 'block', textAlign: 'center' }}
        href={telegram.botUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open Telegram
      </a>
      {telegram.botUsername && (
        <p className="muted" style={{ marginTop: 10 }}>
          Or message @{telegram.botUsername} and press <strong>Start</strong>.
        </p>
      )}
    </div>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img className="auth-logo" src="/logo.png" alt="" />
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
          <>
            {telegramCta}
            <div className="center muted" style={{ margin: '4px 0 16px' }}>
              — or use your phone number —
            </div>
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
              <button className="btn btn-secondary btn-block" disabled={busy}>
                {busy ? 'Sending…' : 'Send verification code'}
              </button>
            </form>
          </>
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
                <div>
                  We couldn't reach you automatically. The quickest fix is to link{' '}
                  <strong>Telegram</strong> — open the bot, tap <strong>Share my phone number</strong>,
                  and your code arrives instantly.
                </div>
                {telegram.available && telegram.botUrl && (
                  <a
                    className="btn btn-sm"
                    style={{ display: 'inline-block', marginTop: 10 }}
                    href={telegram.botUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Telegram
                  </a>
                )}
                <div className="muted" style={{ marginTop: 10 }}>
                  Still stuck? As a last resort, ask a surau admin to generate a login code for you.
                </div>
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