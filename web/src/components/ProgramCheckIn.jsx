import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  startCamera, stopCamera, captureDescriptor, loadModels, qualityMessage,
} from '../lib/face.js';
import { getAccuratePosition, formatDistance } from '../lib/geo.js';
import { FaceTips, useFaceFeedback } from './FaceTips.jsx';

/**
 * Face-verified, geofenced check-in for a single program.
 *
 * The same flow serves a member checking themselves in and a guardian checking
 * in a dependent: `forUserId` is only sent when the person being checked in is
 * not the caller. The server re-verifies the face against that member, so a
 * mismatch is rejected rather than silently recorded.
 *
 * Calls `onDone(result)` once the server accepts the check-in.
 */
export default function ProgramCheckIn({ program, forUserId = null, memberName, onDone, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const feedback = useFaceFeedback(videoRef, cameraOn, { enabled: !busy });

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
      // Checking in someone else means holding the phone up to them, so use the
      // rear camera; a self check-in uses the front camera.
      streamRef.current = await startCamera(videoRef.current, forUserId ? 'environment' : 'user');
      setCameraOn(true);
      setStatus(`Center ${forUserId ? `${memberName}'s` : 'your'} face and tap Verify.`);
    } catch (err) {
      setError(`Camera error: ${err.message}. Please allow camera access.`);
      setStatus('');
    }
  }

  async function verify() {
    setError('');
    setBusy(true);
    setStatus('Verifying…');
    try {
      const captured = await captureDescriptor(videoRef.current);
      if (!captured) {
        setStatus(qualityMessage(['no-face']));
        return;
      }
      if (captured.issues.length > 0) {
        setStatus(qualityMessage(captured.issues));
        return;
      }

      // The device must be at the venue; the server enforces the geofence.
      setStatus('Getting location…');
      const pos = await getAccuratePosition({
        desiredAccuracy: 50,
        timeout: 15000,
        onProgress: (acc) => setStatus(`Getting location… (±${Math.round(acc)} m)`),
      });

      const payload = {
        descriptor: captured.descriptor,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
      };
      if (forUserId) payload.forUserId = forUserId;

      setStatus('Verifying…');
      const res = await api.checkInProgram(program.id, payload);
      stopCamera(streamRef.current);
      setCameraOn(false);
      setStatus('');
      onDone(res);
    } catch (err) {
      setError(err.message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 className="card-title">📷 Check in to {program.title}</h2>
        {onCancel && (
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {status && <div className="alert alert-info">{status}</div>}

      <div className="face-enroll-grid">
        <div>
          <div className="camera-wrap">
            <video
              ref={videoRef}
              className={forUserId ? undefined : 'camera-mirror'}
              playsInline
              muted
            />
            {cameraOn && <div className="camera-overlay" />}
            {cameraOn && (
              <div className="camera-hint">{feedback || 'Center the face in the frame'}</div>
            )}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            {!cameraOn ? (
              <button className="btn btn-block" onClick={enableCamera} disabled={busy}>
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
        <FaceTips compact title="Check-in tips" />
      </div>

      <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
        You must be within {formatDistance(program.radius_meters || 150)} of{' '}
        {program.latitude != null ? 'the program venue' : 'the surau'} to check in.
      </p>
    </div>
  );
}
