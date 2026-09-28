import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import FaceScan from '../components/FaceScan.jsx';
import MemberPicker from '../components/MemberPicker.jsx';
import { formatDate, can, MERIT_MIN_POINTS, MERIT_MAX_POINTS } from '../lib/constants.js';

/**
 * Merits page.
 *
 * - Members see the merits they have earned.
 * - Teachers/AJK (and admins) scan a youth's face at the surau and award
 *   points for good behaviour; the record stores who awarded it.
 */
export default function MeritsPage() {
  const { user } = useAuth();
  const canManage = can(user, 'manageMerits');
  const canIdentify = can(user, 'identifyMembers');

  const [mine, setMine] = useState({ total: 0, merits: [] });
  const [members, setMembers] = useState([]);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [proof, setProof] = useState(null);

  const [form, setForm] = useState({ userId: '', points: 5, reason: '' });
  function loadMine() {
    api.myMerits().then(setMine).catch((e) => setError(e.message));
  }

  function loadRecent() {
    if (!canManage) return;
    api.listMerits().then((d) => setRecent(d.merits)).catch((e) => setError(e.message));
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

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!form.userId) {
      setError('Please choose a member to award merits to.');
      return;
    }
    setBusy(true);
    try {
      await api.awardMerit({
        userId: form.userId,
        points: Number(form.points),
        reason: form.reason,
        ...(proof || {}),
      });
      setNotice('Merit awarded.');
      setForm({ userId: '', points: 5, reason: '' });
      setProof(null);
      loadRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    setError('');
    try {
      await api.deleteMerit(id);
      loadRecent();
      loadMine();
    } catch (err) {
      setError(err.message);
    }
  }

  function onScanConfirmed({ member, descriptor, latitude, longitude }) {
    setProof({ descriptor, latitude, longitude });
    setForm((f) => ({ ...f, userId: member.id }));
    setScanOpen(false);
    setNotice(`Scanned ${member.fullName}. Complete the form to award.`);
  }

  const selectedName = members.find((m) => m.id === form.userId)?.fullName;

  return (
    <div>
      <h1 className="page-title">🏅 Merits</h1>
      <p className="page-sub">
        {canManage
          ? 'Award points to members for good behaviour and contributions.'
          : 'Points you have earned for good behaviour.'}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{mine.total}</div>
          <div className="label">🏅 My merit points</div>
        </div>
        <div className="stat">
          <div className="value">{mine.merits.length}</div>
          <div className="label">Awards received</div>
        </div>
      </div>

      {canManage && (
        <>
          {scanOpen && (
            <FaceScan onConfirmed={onScanConfirmed} onCancel={() => setScanOpen(false)} />
          )}

          <form className="card" onSubmit={submit}>
            <h2 className="card-title">Award merits</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Scan the member's face at the surau, then award points.
            </p>

            {canIdentify && (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                style={{ marginBottom: 12 }}
                onClick={() => setScanOpen(true)}
              >
                📷 Scan member's face
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
                emptyLabel="Select member…"
                placeholder="Search a member…"
                noResultsLabel="No members match that name."
                onChange={(id) => {
                  setForm({ ...form, userId: id });
                  setProof(null);
                }}
                options={members.map((m) => ({
                  value: m.id,
                  label: m.fullName,
                  // Phone tail disambiguates same-named members; dependents have
                  // no phone, so mark them as children instead.
                  sublabel: m.isDependent ? 'child' : m.phoneLast4 || '',
                  searchText: [m.phone, m.isDependent ? 'child' : ''].filter(Boolean).join(' '),
                }))}
              />
            </div>

            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Points</label>
                <input
                  type="number"
                  min={MERIT_MIN_POINTS}
                  max={MERIT_MAX_POINTS}
                  value={form.points}
                  onChange={(e) => setForm({ ...form, points: e.target.value })}
                  required
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label>Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Helped clean the surau"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  required
                />
              </div>
            </div>

            {form.userId && !proof && (
              <div className="alert alert-info">
                Awarding to <strong>{selectedName}</strong> requires a face scan at the surau.
              </div>
            )}

            <button className="btn btn-block" disabled={busy}>
              {busy ? 'Saving…' : 'Award merit'}
            </button>
          </form>
        </>
      )}

      <div className="card">
        <h2 className="card-title">My merits</h2>
        {mine.merits.length === 0 ? (
          <p className="muted">No merits yet.</p>
        ) : (
          mine.merits.slice(0, 10).map((m) => (
            <div key={m.id} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--amber-400)', color: '#78350f' }}>
                +{m.points}
              </div>
              <div className="leader-name">
                {m.reason}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {formatDate(m.awarded_at)}
                  {m.awarded_by_name ? ` · by ${m.awarded_by_name}` : ''}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {canManage && (
        <div className="card">
          <h2 className="card-title">Recent awards (all members)</h2>
          {recent.length === 0 ? (
            <p className="muted">No merits awarded yet.</p>
          ) : (
            recent.slice(0, 20).map((m) => (
              <div key={m.id} className="leader-row">
                <div className="rank-badge" style={{ background: 'var(--amber-400)', color: '#78350f' }}>
                  +{m.points}
                </div>
                <div className="leader-name">
                  {m.full_name}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {m.reason} · {formatDate(m.awarded_at)}
                    {m.awarded_by_name ? ` · by ${m.awarded_by_name}` : ''}
                  </div>
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => revoke(m.id)}>
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
