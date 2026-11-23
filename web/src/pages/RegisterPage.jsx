import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  startCamera, stopCamera, captureEnrollmentDescriptor, loadModels,
} from '../lib/face.js';
import { FaceTips, useFaceFeedback } from '../components/FaceTips.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';

export default function RegisterPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [form, setForm] = useState({
    fullName: user?.fullName && user.fullName !== 'New Member' ? user.fullName : '',
    birthDate: user?.birthDate || '',
    gender: user?.gender || '',
    address: user?.address || '',
  });
  const [error, setError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSaved, setProfileSaved] = useState(
    Boolean(user?.fullName && user.fullName !== 'New Member' && user?.birthDate)
  );
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [faceStatus, setFaceStatus] = useState('');

  // Live framing/lighting feedback while the camera is open (paused during capture).
  const feedback = useFaceFeedback(videoRef, cameraOn, { enabled: !busy });

  useEffect(() => () => stopCamera(streamRef.current), []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveProfile(e) {
    e.preventDefault();
    setError('');
    setProfileSuccess('');
    setBusy(true);
    try {
      await api.updateProfile({
        fullName: form.fullName,
        birthDate: form.birthDate || null,
        gender: form.gender || null,
        address: form.address,
      });
      await refreshUser();
      setProfileSaved(true);
      setProfileSuccess('Profile details saved successfully! You can now enroll your face below, or continue to Home.');
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
    setFaceStatus('Starting — hold still…');
    setBusy(true);
    try {
      // Average several frames for a more stable descriptor than a single shot.
      const result = await captureEnrollmentDescriptor(videoRef.current, {
        shots: 5,
        onProgress: (done, total) => setFaceStatus(`Hold still… ${done + 1} of ${total}`),
      });
      if (!result) {
        setFaceStatus('No face detected. Improve the lighting and centre your face, then try again.');
        return;
      }
      await api.enrollFace(result.descriptor);
      await refreshUser();
      stopCamera(streamRef.current);
      setCameraOn(false);
      setFaceStatus(
        result.clean >= 2
          ? 'Face enrolled successfully!'
          : 'Face enrolled — but the scan quality was low. Consider re-enrolling in better light.',
      );
      if (result.clean >= 2) setTimeout(() => navigate('/home', { replace: true }), 900);
    } catch (err) {
      setError(err.message);
      setFaceStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Complete your profile</h1>
      <p className="page-sub">Tell us about yourself, then optionally enroll your face for faster check-in.</p>

      {error && <div className="alert alert-error">{error}</div>}
      {profileSuccess && <div className="alert alert-success">{profileSuccess}</div>}

      <form className="card" onSubmit={saveProfile}>
        <h2 className="card-title">1. Member Details</h2>
        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            placeholder="e.g. Ahmad bin Abdullah"
            required
          />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="birthDate">Date of birth</label>
            <input
              id="birthDate"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={form.birthDate}
              onChange={(e) => update('birthDate', e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="gender">Gender</label>
            <select
              id="gender"
              value={form.gender}
              onChange={(e) => update('gender', e.target.value)}
              required
            >
              <option value="">Select…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="address">Address</label>
          <AddressAutocomplete
            id="address"
            value={form.address}
            onChange={(v) => update('address', v)}
            required
            placeholder="e.g. No 12, Jalan Cerdik, Taman Universiti"
          />
        </div>

        {profileSaved ? (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy}>
              {busy ? 'Saving…' : 'Update details'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              onClick={() => navigate('/home', { replace: true })}
            >
              Continue to Home →
            </button>
          </div>
        ) : (
          <>
            <button className="btn btn-block" disabled={busy}>
              {busy ? 'Saving…' : 'Save profile details'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              onClick={() => navigate('/home', { replace: true })}
            >
              Skip for now (Go to Home)
            </button>
          </>
        )}
      </form>

      <div className="card">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>2. Face enrollment</span>
          <span className="pill" style={{ fontSize: '0.8rem', fontWeight: 400 }}>Optional</span>
        </h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          We store a mathematical face descriptor — not a photo. It enables 1-second check-in at the surau.
          You can also enroll or update this anytime in your Profile.
        </p>

        {faceStatus && <div className="alert alert-info">{faceStatus}</div>}

        <div className="face-enroll-grid">
          <div>
            <div className="camera-wrap">
              <video ref={videoRef} className="camera-mirror" playsInline muted />
              {cameraOn && <div className="camera-overlay" />}
              {cameraOn && <div className="camera-hint">{feedback || 'Center your face in the frame'}</div>}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              {!cameraOn ? (
                <button className="btn btn-block" onClick={enableCamera} disabled={busy}>
                  Open camera to enroll
                </button>
              ) : (
                <>
                  <button className="btn" style={{ flex: 1 }} onClick={enrollFace} disabled={busy}>
                    {busy ? 'Scanning…' : 'Capture & enroll'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
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

          <FaceTips />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 20, marginBottom: 32 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/home', { replace: true })}
        >
          Done — Go to Home →
        </button>
      </div>
    </div>
  );
}