import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import FaceScan from '../components/FaceScan.jsx';
import MemberPicker from '../components/MemberPicker.jsx';
import QuranLogDetails from '../components/QuranLogDetails.jsx';
import { getPosition } from '../lib/geo.js';
import { can, formatDate } from '../lib/constants.js';

/**
 * Quran activity page.
 *
 * - Members log their own recitation/memorization.
 * - Teachers (and admins) can record on a member's behalf. They must be at the
 *   surau (geofence), but may select the member manually - a face scan is
 *   optional, so a whole class can be recorded swiftly. The record stores who
 *   submitted it.
 */
export default function QuranPage() {
  const { user } = useAuth();
  const canManage = can(user, 'manageQuran');
  const canIdentify = can(user, 'identifyMembers');

  const [mine, setMine] = useState({ recitation: 0, memorization: 0, logs: [] });
  const [members, setMembers] = useState([]);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [proof, setProof] = useState(null);

  // Editing an existing log (teachers/admins, or your own). Only the content is
  // editable — the member and date are fixed.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ kind: 'recitation', surah: '', juz: '', pages: '', note: '' });
  const [editBusy, setEditBusy] = useState(false);

  const [form, setForm] = useState({
    userId: '',
    kind: 'recitation',
    surah: '',
    juz: '',
    pages: '',
    note: '',
  });

  function loadMine() {
    api.myQuran().then(setMine).catch((e) => setError(e.message));
  }

  function loadRecent() {
    if (!canManage) return;
    api.listQuran().then((d) => setRecent(d.logs)).catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadMine();
    loadRecent();
    if (canManage) {
      api
        .listUsers()
        .then((d) => setMembers(d.users))
        .catch((e) => setError(e.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordingForOther = canManage && form.userId && form.userId !== user?.id;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      // Every Quran log must be recorded at the surau (the server enforces the
      // geofence). Reuse the scanned location when we have it, otherwise fetch
      // it now.
      let location = proof;
      if (!location) {
        setNotice('Getting location…');
        const pos = await getPosition();
        location = { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy };
      }

      await api.logQuran({
        forUserId: form.userId || undefined,
        kind: form.kind,
        surah: form.surah || null,
        juz: form.juz ? Number(form.juz) : null,
        pages: form.pages ? Number(form.pages) : null,
        note: form.note || null,
        ...(location || {}),
      });
      setNotice('Quran activity recorded.');
      setForm({ userId: '', kind: form.kind, surah: '', juz: '', pages: '', note: '' });
      setProof(null);
      loadMine();
      loadRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await api.deleteQuran(id);
      loadMine();
      loadRecent();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(log) {
    setError('');
    setNotice('');
    setEditing(log);
    setEditForm({
      kind: log.kind,
      surah: log.surah || '',
      juz: log.juz ?? '',
      pages: log.pages ?? '',
      note: log.note || '',
    });
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setEditBusy(true);
    try {
      await api.updateQuran(editing.id, {
        kind: editForm.kind,
        surah: editForm.surah || null,
        juz: editForm.juz ? Number(editForm.juz) : null,
        pages: editForm.pages ? Number(editForm.pages) : null,
        note: editForm.note || null,
      });
      setNotice('Quran activity updated.');
      setEditing(null);
      loadMine();
      loadRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setEditBusy(false);
    }
  }

  function onScanConfirmed({ member, descriptor, latitude, longitude }) {
    setProof({ descriptor, latitude, longitude });
    setForm((f) => ({ ...f, userId: member.id }));
    setScanOpen(false);
    setNotice(`Scanned ${member.fullName}. Complete the form to record.`);
  }

  const selectedName = members.find((m) => m.id === form.userId)?.fullName;

  return (
    <div>
      <h1 className="page-title">📖 Quran activity</h1>
      <p className="page-sub">
        {canManage
          ? 'Record recitation and memorization for members at the surau.'
          : 'Log your recitation and memorization to earn badges.'}
      </p>
      <p className="muted" style={{ marginTop: -8 }}>
        📍 Must be at the surau · one log per hour per member.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{mine.recitation}</div>
          <div className="label">📖 My recitations</div>
        </div>
        <div className="stat">
          <div className="value">{mine.memorization}</div>
          <div className="label">🧠 My memorizations</div>
        </div>
      </div>

      {scanOpen && (
        <FaceScan onConfirmed={onScanConfirmed} onCancel={() => setScanOpen(false)} />
      )}

      <form className="card" onSubmit={submit}>
        <h2 className="card-title">Record activity</h2>

        {canManage && (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              Select the member, then record their activity. You must be at the surau.
              Scanning a face is optional.
            </p>
            {canIdentify && (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                style={{ marginBottom: 12 }}
                onClick={() => setScanOpen(true)}
              >
                📷 Scan face (optional)
              </button>
            )}
            {proof && (
              <div className="alert alert-success">
                ✅ Face verified for <strong>{selectedName || 'member'}</strong>
              </div>
            )}
            <div className="field">
              <label>Member</label>
              <MemberPicker
                value={form.userId}
                emptyLabel={`Myself (${user?.fullName})`}
                placeholder="Search a member…"
                noResultsLabel="No members match that name."
                onChange={(id) => {
                  setForm({ ...form, userId: id });
                  setProof(null);
                }}
                options={members
                  .filter((m) => m.id !== user?.id)
                  .map((m) => ({
                    value: m.id,
                    label: m.fullName,
                    // Phone tail disambiguates same-named members; dependents
                    // have no phone, so mark them as children instead.
                    sublabel: m.isDependent ? 'child' : m.phoneLast4 || '',
                    searchText: [m.phone, m.isDependent ? 'child' : ''].filter(Boolean).join(' '),
                  }))}
              />
            </div>
          </>
        )}

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Type</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="recitation">Recitation</option>
              <option value="memorization">Memorization</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Surah (optional)</label>
            <input
              type="text"
              placeholder="e.g. Al-Kahf"
              value={form.surah}
              onChange={(e) => setForm({ ...form, surah: e.target.value })}
            />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Juz (optional)</label>
            <input
              type="number"
              min="1"
              max="30"
              value={form.juz}
              onChange={(e) => setForm({ ...form, juz: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Pages (optional)</label>
            <input
              type="number"
              min="1"
              value={form.pages}
              onChange={(e) => setForm({ ...form, pages: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label>Note (optional)</label>
          <input
            type="text"
            placeholder="Anything to remember"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        {recordingForOther && !proof && (
          <div className="alert alert-info">
            Recording for <strong>{selectedName}</strong>. Your location will be checked
            to confirm you are at the surau.
          </div>
        )}

        <button className="btn btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Log activity'}
        </button>
      </form>

      <div className="card">
        <h2 className="card-title">My recent activity</h2>
        {mine.logs.length === 0 ? (
          <p className="muted">No activity logged yet.</p>
        ) : (
          mine.logs.slice(0, 10).map((log) => (
            <div key={log.id} className="quran-log-row">
              <QuranLogDetails log={log} />
              <div className="row-btns">
                <button className="btn btn-sm btn-secondary" onClick={() => startEdit(log)}>
                  Edit
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => remove(log.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {mine.family?.length > 0 && (
        <div className="card">
          <h2 className="card-title">👨‍👩‍👧 My children's activity</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            What your children recited or memorized, including notes from their teacher.
          </p>
          {mine.family.slice(0, 20).map((log) => (
            <div key={log.id} className="quran-log-row">
              <QuranLogDetails log={log} showMember />
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2 className="card-title">Recent activity (all members)</h2>
          {recent.length === 0 ? (
            <p className="muted">No Quran activity recorded yet.</p>
          ) : (
            recent.slice(0, 20).map((log) => (
              <div key={log.id} className="quran-log-row">
                <QuranLogDetails log={log} showMember />
                <div className="row-btns">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEdit(log)}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => remove(log.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {editing && (
        <form className="card" onSubmit={saveEdit}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="card-title" style={{ margin: 0 }}>✏️ Edit Quran activity</h2>
            <button type="button" className="btn btn-sm btn-secondary" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {editing.full_name ? `For ${editing.full_name} · ` : ''}
            {formatDate(editing.logged_date)}. The member and date cannot be changed.
          </p>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Type</label>
              <select
                value={editForm.kind}
                onChange={(e) => setEditForm({ ...editForm, kind: e.target.value })}
              >
                <option value="recitation">Recitation</option>
                <option value="memorization">Memorization</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Surah (optional)</label>
              <input
                type="text"
                placeholder="e.g. Al-Kahf"
                value={editForm.surah}
                onChange={(e) => setEditForm({ ...editForm, surah: e.target.value })}
              />
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Juz (optional)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={editForm.juz}
                onChange={(e) => setEditForm({ ...editForm, juz: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Pages (optional)</label>
              <input
                type="number"
                min="1"
                value={editForm.pages}
                onChange={(e) => setEditForm({ ...editForm, pages: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label>Note (optional)</label>
            <input
              type="text"
              placeholder="Anything to remember"
              value={editForm.note}
              onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
            />
          </div>

          <button className="btn btn-block" disabled={editBusy}>
            {editBusy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}
    </div>
  );
}
