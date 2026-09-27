import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { startCamera, stopCamera, captureDescriptor, loadModels } from '../lib/face.js';

export default function RegisterPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [form, setForm] = useState({
    fullName: user?.fullName && user.fullName !== 'New Member' ? user.fullName : '',
    age: user?.age || '',
    gender: user?.gender || '',
    address: user?.address || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [faceStatus, setFaceStatus] = useState('');

  useEffect(() => () => stopCamera(streamRef.current), []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveProfile(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.updateProfile({
        fullName: form.fullName,
        age: form.age ? Number(form.age) : null,
        gender: form.gender || null,
        address: form.address || null,
      });
      await refreshUser();
      setFaceStatus('Profile saved. Now enroll your face.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function enableCamera() {
    setError('');
    try {
      await loadModels();
      streamRef.current = await startCamera(videoRef.current);
      setCameraOn(true);
    } catch (err) {
      setError(`Camera error: ${err.message}`);
    }
  }

  async function enrollFace() {
    setError('');
    setFaceStatus('Scanning…');
    try {
      const result = await captureDescriptor(videoRef.current);
      if (!result) {
        setFaceStatus('No face detected. Make sure your face is well lit and centered.');
        return;
      }
      await api.enrollFace(result.descriptor);
      await refreshUser();
      stopCamera(streamRef.current);
      setCameraOn(false);
      setFaceStatus('Face enrolled successfully!');
      setTimeout(() => navigate('/', { replace: true }), 900);
    } catch (err) {
      setError(err.message);
      setFaceStatus('');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">🕌</span>
          <span>Registration</span>
        </div>
      </header>
      <main className="main">
        <h1 className="page-title">Complete your profile</h1>
        <p className="page-sub">Tell us about yourself, then enroll your face for check-in.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form className="card" onSubmit={saveProfile}>
          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              required
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="age">Age</label>
              <input
                id="age"
                type="number"
                min="5"
                max="120"
                value={form.age}
                onChange={(e) => update('age', e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="gender">Gender</label>
              <select id="gender" value={form.gender} onChange={(e) => update('gender', e.target.value)}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="address">Address (optional)</label>
            <input
              id="address"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
            />
          </div>
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        <div className="card">
          <h2 className="card-title">Face enrollment</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            We store a mathematical face descriptor — not a photo. It is used only to verify your
            attendance.
          </p>

          {faceStatus && <div className="alert alert-info">{faceStatus}</div>}

          <div className="camera-wrap">
            <video ref={videoRef} playsInline muted />
            {cameraOn && <div className="camera-overlay" />}
            {cameraOn && <div className="camera-hint">Center your face in the frame</div>}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            {!cameraOn ? (
              <button className="btn btn-block" onClick={enableCamera}>
                Open camera
              </button>
            ) : (
              <>
                <button className="btn" style={{ flex: 1 }} onClick={enrollFace}>
                  Capture & enroll
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    stopCamera(streamRef.current);
                    setCameraOn(false);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}