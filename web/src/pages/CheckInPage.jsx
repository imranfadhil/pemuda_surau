import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { startCamera, stopCamera, captureDescriptor, loadModels } from '../lib/face.js';
import { PRAYERS } from '../lib/constants.js';

export default function CheckInPage() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [prayer, setPrayer] = useState(PRAYERS[0].key);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState([]);

  useEffect(() => {
    api.myToday().then((t) => setToday(t.prayers)).catch(() => {});
    return () => stopCamera(streamRef.current);
  }, []);

  async function enableCamera() {
    setError('');
    setStatus('Loading face models…');
    try {
      await loadModels();
      streamRef.current = await startCamera(videoRef.current);
      setCameraOn(true);
      setStatus('Center your face and tap Verify.');
    } catch (err) {
      setError(`Camera error: ${err.message}. Please allow camera access.`);
      setStatus('');
    }
  }

  async function verify() {
    setError('');
    setResult(null);
    setBusy(true);
    setStatus('Verifying…');
    try {
      const captured = await captureDescriptor(videoRef.current);
      if (!captured) {
        setStatus('No face detected. Move closer and improve lighting.');
        return;
      }
      const res = await api.checkIn({
        prayer,
        descriptor: captured.descriptor,
      });
      setResult(res);
      setStatus('');
      setToday((prev) => (prev.includes(prayer) ? prev : [...prev, prayer]));
      stopCamera(streamRef.current);
      setCameraOn(false);
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Prayer check-in</h1>
      <p className="page-sub">Select the prayer, then verify your face.</p>

      <div className="card">
        <h2 className="card-title">Which prayer?</h2>
        <div className="tab-row" style={{ marginTop: 12 }}>
          {PRAYERS.map((p) => (
            <button
              key={p.key}
              className={`tab ${prayer === p.key ? 'active' : ''}`}
              onClick={() => setPrayer(p.key)}
            >
              {p.label} {today.includes(p.key) ? '✓' : ''}
            </button>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {status && <div className="alert alert-info">{status}</div>}
        {result && (
          <div className="alert alert-success">
            Checked in for <strong>{result.attendance.prayer}</strong>! Confidence{' '}
            {(result.confidence * 100).toFixed(1)}%
          </div>
        )}

        <div className="camera-wrap">
          <video ref={videoRef} playsInline muted />
          {cameraOn && <div className="camera-overlay" />}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          {!cameraOn ? (
            <button className="btn btn-block" onClick={enableCamera}>
              Open camera
            </button>
          ) : (
            <>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={verify}>
                {busy ? 'Verifying…' : 'Verify & check in'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  stopCamera(streamRef.current);
                  setCameraOn(false);
                  setStatus('');
                }}
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Today's progress</h2>
        <div className="prayer-grid" style={{ marginTop: 12 }}>
          {PRAYERS.map((p) => (
            <div key={p.key} className={`prayer-tile ${today.includes(p.key) ? 'done' : ''}`}>
              <div className="check">{today.includes(p.key) ? '✅' : '⭕'}</div>
              <div>{p.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}