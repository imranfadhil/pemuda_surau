import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { startCamera, stopCamera, captureDescriptor, loadModels } from '../lib/face.js';
import { ageLabel } from '../lib/age.js';

const emptyForm = { fullName: '', birthDate: '', gender: 'male' };

export default function DependentPage() {
  const [dependents, setDependents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Face enrollment state (one dependent at a time).
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [enrolling, setEnrolling] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [faceStatus, setFaceStatus] = useState('');

  function load() {
    setLoading(true);
    api
      .listDependents()
      .then((d) => setDependents(d.dependents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    return () => stopCamera(streamRef.current);
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(dep) {
    setEditingId(dep.id);
    setForm({ fullName: dep.fullName, birthDate: dep.birthDate || '', gender: dep.gender || 'male' });
    setError('');
    setNotice('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const payload = {
      fullName: form.fullName,
      birthDate: form.birthDate || null,
      gender: form.gender || null,
    };
    try {
      if (editingId) {
        await api.updateDependent(editingId, payload);
        setNotice('Dependent updated.');
      } else {
        await api.createDependent(payload);
        setNotice('Dependent added. Now enroll their face.');
      }
      cancelEdit();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(dep) {
    if (!window.confirm(`Remove ${dep.fullName}? Their attendance records will also be deleted.`)) {
      return;
    }
    setError('');
    setNotice('');
    try {
      await api.deleteDependent(dep.id);
      setNotice(`${dep.fullName} removed.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function startEnroll(dep) {
    setError('');
    setNotice('');
    setFaceStatus('');
    setEnrolling(dep);
    try {
      await loadModels();
      streamRef.current = await startCamera(videoRef.current);
      setCameraOn(true);
      setFaceStatus(`Center ${dep.fullName}'s face and tap Capture.`);
    } catch (err) {
      setError(`Camera error: ${err.message}`);
      setEnrolling(null);
    }
  }

  async function capture() {
    setError('');
    setFaceStatus('Scanning…');
    try {
      const result = await captureDescriptor(videoRef.current);
      if (!result) {
        setFaceStatus('No face detected. Make sure the face is well lit and centered.');
        return;
      }
      await api.enrollDependentFace(enrolling.id, result.descriptor);
      stopCamera(streamRef.current);
      setCameraOn(false);
      setFaceStatus(`${enrolling.fullName}'s face enrolled successfully!`);
      setEnrolling(null);
      load();
    } catch (err) {
      setError(err.message);
      setFaceStatus('');
    }
  }

  function stopEnroll() {
    stopCamera(streamRef.current);
    setCameraOn(false);
    setEnrolling(null);
    setFaceStatus('');
  }

  return (
    <div>
      <h1 className="page-title">Family</h1>
      <p className="page-sub">
        Add your children so you can check them in for prayers — no phone needed for them.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <form className="card" onSubmit={save}>
        <h2 className="card-title">{editingId ? 'Edit dependent' : 'Add a dependent'}</h2>
        <div className="field">
          <label htmlFor="depName">Full name</label>
          <input
            id="depName"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            required
          />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="depBirthDate">Date of birth</label>
            <input
              id="depBirthDate"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={form.birthDate}
              onChange={(e) => update('birthDate', e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="depGender">Gender</label>
            <select
              id="depGender"
              value={form.gender}
              onChange={(e) => update('gender', e.target.value)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn" style={{ flex: 1 }} disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add dependent'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <h2 className="card-title">Your dependents ({dependents.length})</h2>
        {loading ? (
          <p className="muted" style={{ marginTop: 12 }}>Loading…</p>
        ) : dependents.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            No dependents yet. Add one above.
          </p>
        ) : (
          <div style={{ marginTop: 12 }}>
            {dependents.map((dep) => (
              <div key={dep.id} className="leader-row">
                <div className="leader-name">
                  {dep.fullName}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {ageLabel(dep.birthDate)}
                    {dep.gender ? ` · ${dep.gender}` : ''}
                  </div>
                </div>
                <span className={`pill ${dep.hasFace ? '' : 'warn'}`}>
                  {dep.hasFace ? 'face ✓' : 'no face'}
                </span>
                <button className="btn btn-sm btn-secondary" onClick={() => startEnroll(dep)}>
                  {dep.hasFace ? 'Re-enroll' : 'Enroll face'}
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => startEdit(dep)}>
                  Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(dep)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {enrolling && (
        <div className="card">
          <h2 className="card-title">Enroll face — {enrolling.fullName}</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            We store a mathematical face descriptor — not a photo.
          </p>
          {faceStatus && <div className="alert alert-info">{faceStatus}</div>}
          <div className="camera-wrap">
            <video ref={videoRef} playsInline muted />
            {cameraOn && <div className="camera-overlay" />}
            {cameraOn && <div className="camera-hint">Center the face in the frame</div>}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" style={{ flex: 1 }} onClick={capture} disabled={!cameraOn}>
              Capture & enroll
            </button>
            <button className="btn btn-secondary" onClick={stopEnroll}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="muted">
        <Link to="/profile">← Back to profile</Link>
      </p>
    </div>
  );
}
