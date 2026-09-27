import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { startCamera, stopCamera, captureDescriptor, loadModels } from '../lib/face.js';
import { getPosition } from '../lib/geo.js';

/**
 * Staff face-scan flow: scan a youth's face at the surau, get a *suggested*
 * match, then confirm before anything is recorded.
 *
 * Calls `onConfirmed({ member, descriptor, latitude, longitude })` once the
 * staff member accepts the suggestion. The parent form then submits the
 * activity with those values.
 */
export default function FaceScan({ onConfirmed, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [captured, setCaptured] = useState(null);

  useEffect(
    () => () => {
      stopCamera(streamRef.current);
    },
    [],
  );

  async function enableCamera() {
    setError('');
    setStatus('Loading face models…');
    try {
      await loadModels();
      streamRef.current = await startCamera(videoRef.current);
      setCameraOn(true);
      setStatus('Center the member\'s face and tap Scan.');
    } catch (err) {
      setError(`Camera error: ${err.message}. Please allow camera access.`);
      setStatus('');
    }
  }

  async function scan() {
    setError('');
    setSuggestion(null);
    setBusy(true);
    setStatus('Scanning…');
    try {
      const shot = await captureDescriptor(videoRef.current);
      if (!shot) {
        setStatus('No face detected. Move closer and improve lighting.');
        return;
      }

      setStatus('Getting location…');
      const pos = await getPosition();

      setStatus('Identifying…');
      const res = await api.identify({
        descriptor: shot.descriptor,
        latitude: pos.latitude,
        longitude: pos.longitude,
      });

      setCaptured({ descriptor: shot.descriptor, latitude: pos.latitude, longitude: pos.longitude });
      setSuggestion(res);
      setStatus('');
      stopCamera(streamRef.current);
      setCameraOn(false);
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!suggestion || !captured) return;
    onConfirmed({ member: suggestion.match, ...captured });
  }

  function rescan() {
    setSuggestion(null);
    setCaptured(null);
    setError('');
    enableCamera();
  }

  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 className="card-title">📷 Scan member</h2>
        {onCancel && (
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {status && <div className="alert alert-info">{status}</div>}

      {!suggestion && (
        <>
          <div className="camera-wrap">
            <video ref={videoRef} playsInline muted />
            {cameraOn && <div className="camera-overlay" />}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            {!cameraOn ? (
              <button className="btn btn-block" onClick={enableCamera} disabled={busy}>
                Open camera
              </button>
            ) : (
              <button className="btn btn-block" onClick={scan} disabled={busy}>
                {busy ? 'Scanning…' : 'Scan face'}
              </button>
            )}
          </div>
        </>
      )}

      {suggestion && (
        <>
          <div className="alert alert-success">
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{suggestion.match.fullName}</div>
            <div className="muted">
              Confidence {(suggestion.match.confidence * 100).toFixed(1)}%
              {suggestion.match.isDependent ? ' · child account' : ''}
              {suggestion.distanceFromSurau != null
                ? ` · ${suggestion.distanceFromSurau} m from surau`
                : ''}
            </div>
          </div>

          {suggestion.runnerUp && (
            <p className="muted" style={{ marginTop: -6 }}>
              Next closest: {suggestion.runnerUp.fullName} (
              {(suggestion.runnerUp.confidence * 100).toFixed(1)}%)
            </p>
          )}

          <div className="alert alert-info">
            Confirm this is the right person before recording. If it's wrong, rescan.
          </div>

          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={confirm}>
              ✓ Confirm {suggestion.match.fullName}
            </button>
            <button className="btn btn-secondary" onClick={rescan}>
              Rescan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
