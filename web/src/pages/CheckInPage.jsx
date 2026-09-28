import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  startCamera, stopCamera, captureDescriptor, loadModels, qualityMessage,
} from '../lib/face.js';
import { getAccuratePosition } from '../lib/geo.js';
import { FaceTips, useFaceFeedback } from '../components/FaceTips.jsx';
import { PRAYERS, PRAYER_LABELS } from '../lib/constants.js';

function formatClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function countdown(targetIso, now) {
  if (!targetIso) return '';
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return 'now';
  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function CheckInPage() {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [win, setWin] = useState(null);
  const [winError, setWinError] = useState('');
  const [now, setNow] = useState(Date.now());

  // Live framing/lighting feedback while the camera is open (paused during capture).
  const feedback = useFaceFeedback(videoRef, cameraOn, { enabled: !busy });

  function loadWindow() {
    api
      .currentWindow()
      .then((data) => {
        setWin(data);
        setWinError('');
      })
      .catch((err) => setWinError(err.message || 'Could not load prayer times.'));
  }

  function loadFamily() {
    api
      .familyToday()
      .then((data) => {
        setMembers(data.members);
        setSelectedId((prev) => prev || data.members[0]?.id || null);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadFamily();
    loadWindow();
    const poll = setInterval(loadWindow, 60000);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      stopCamera(streamRef.current);
    };
  }, []);

  const selected = members.find((m) => m.id === selectedId) || members[0] || null;
  // A guardian scans a dependent with the rear camera — but a child who has
  // their own login is checking *themselves* in, so treat that as a selfie.
  const selfCheckIn = Boolean(selected) && selected.id === user?.id;
  const today = selected?.prayers || [];
  const current = win?.current || null;
  const next = win?.next || null;
  const activePrayer = current?.prayer || null;
  const alreadyDone = activePrayer ? today.includes(activePrayer) : false;

  async function enableCamera() {
    setError('');
    setStatus('Loading face models…');
    try {
      await loadModels();
      // Scanning a dependent means the guardian is holding the phone up to the
      // child, so use the rear camera; self check-in uses the front camera.
      streamRef.current = await startCamera(videoRef.current, selfCheckIn ? 'user' : 'environment');
      setCameraOn(true);
      setStatus(`Center ${selfCheckIn ? 'your' : `${selected?.fullName}'s`} face and tap Verify.`);
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
        setStatus(qualityMessage(['no-face']));
        return;
      }
      // Refuse an obviously poor frame so we don't waste a match on bad data.
      if (captured.issues.length > 0) {
        setStatus(qualityMessage(captured.issues));
        return;
      }
      // The device must be at the surau; the server enforces the geofence.
      // Wait for a reasonably accurate fix — a coarse Wi-Fi/cell position can be
      // hundreds of metres off and would wrongly report the member as far away.
      setStatus('Getting location…');
      const pos = await getAccuratePosition({
        desiredAccuracy: 50,
        timeout: 15000,
        onProgress: (acc) => setStatus(`Getting location… (±${Math.round(acc)} m)`),
      });
      // The server infers the prayer from the current window.
      const payload = {
        descriptor: captured.descriptor,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
      };
      if (!selfCheckIn) payload.forUserId = selected.id;
      setStatus('Verifying…');
      const res = await api.checkIn(payload);
      setResult(res);
      setStatus('');
      loadFamily();
      stopCamera(streamRef.current);
      setCameraOn(false);
      loadWindow();
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
      <p className="page-sub">Your prayer is detected automatically from the current time.</p>

      {members.length > 1 && (
        <div className="card">
          <h2 className="card-title">Who is checking in?</h2>
          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            {members.map((m) => (
              <button
                key={m.id}
                className={`btn btn-sm ${m.id === selected?.id ? '' : 'btn-secondary'}`}
                onClick={() => {
                  setSelectedId(m.id);
                  setResult(null);
                  setError('');
                }}
              >
                {m.fullName}
                {m.isDependent ? ' (child)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">Current window</h2>
        {!win && winError ? (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {winError}
            <button
              className="btn btn-sm btn-secondary"
              style={{ display: 'block', marginTop: 10 }}
              onClick={loadWindow}
            >
              Try again
            </button>
          </div>
        ) : !win ? (
          <p className="muted" style={{ marginTop: 12 }}>Loading prayer times…</p>
        ) : current ? (
          <>
            <div className="alert alert-success" style={{ marginTop: 12 }}>
              <strong>{PRAYER_LABELS[current.prayer]}</strong> is open for check-in until{' '}
              {formatClock(current.end)}.
            </div>
            <p className="muted">
              Adhan {formatClock(current.adhan)} · window {formatClock(current.start)}–
              {formatClock(current.end)}
            </p>
          </>
        ) : (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            No prayer is open right now.
            {next && (
              <>
                {' '}
                Next: <strong>{PRAYER_LABELS[next.prayer]}</strong> at {formatClock(next.adhan)} (
                in {countdown(next.start, now)}).
              </>
            )}
          </div>
        )}

        {selected && !selected.hasFace && (
          <div className="alert alert-info">
            {selected.isDependent ? (
              `${selected.fullName} has no face enrolled yet. Ask your guardian to enroll it from the Family page.`
            ) : (
              <>
                You need to register your face before you can check in.{' '}
                <Link to="/register"><strong>Enroll your face →</strong></Link>
              </>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {status && <div className="alert alert-info">{status}</div>}
        {result && (
          <div className="alert alert-success">
            Checked in for <strong>{PRAYER_LABELS[result.attendance.prayer]}</strong>! Confidence{' '}
            {(result.confidence * 100).toFixed(1)}%
          </div>
        )}

        <div className="face-enroll-grid">
          <div>
            <div className="camera-wrap">
              <video
                ref={videoRef}
                className={selfCheckIn ? 'camera-mirror' : undefined}
                playsInline
                muted
              />
              {cameraOn && <div className="camera-overlay" />}
              {cameraOn && <div className="camera-hint">{feedback || 'Center the face in the frame'}</div>}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              {!cameraOn ? (
                <button
                  className="btn btn-block"
                  disabled={!current || alreadyDone || !selected?.hasFace}
                  onClick={enableCamera}
                >
                  {alreadyDone
                    ? `Already checked in for ${PRAYER_LABELS[activePrayer]}`
                    : current
                      ? `Open camera for ${PRAYER_LABELS[activePrayer]}`
                      : 'Check-in closed'}
                </button>
              ) : (
                <>
                  <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={verify}>
                    {busy ? 'Verifying…' : `Verify & check in for ${PRAYER_LABELS[activePrayer]}`}
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
      </div>

      <div className="card">
        <h2 className="card-title">
          Today's progress{selected ? ` — ${selected.fullName}` : ''}
        </h2>
        <div className="prayer-grid" style={{ marginTop: 12 }}>
          {PRAYERS.map((p) => (
            <div
              key={p.key}
              className={`prayer-tile ${today.includes(p.key) ? 'done' : ''} ${
                activePrayer === p.key ? 'active' : ''
              }`}
            >
              <div className="check">{today.includes(p.key) ? '✅' : '⭕'}</div>
              <div>{p.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}