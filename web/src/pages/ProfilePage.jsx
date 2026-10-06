import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import { TourButton } from '../components/Tour.jsx';
import { PRAYER_LABELS, formatDate, SURAU, CATEGORIES, badgeFor, ROLE_LABELS } from '../lib/constants.js';
import { ageLabel } from '../lib/age.js';

function BadgesCard() {
  const [scores, setScores] = useState(null);

  useEffect(() => {
    // Use the personal scores endpoint, NOT the leaderboard: the leaderboard is
    // youth-only, so an adult member would not appear in it and would lose
    // their own badges.
    api
      .myScores()
      .then((d) => setScores(d.scores))
      .catch(() => {});
  }, []);

  return (
    <div className="card">
      <h2 className="card-title">🎖️ Your badges</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Earned from your all-time activity in each category.
      </p>
      {!scores ? (
        <p className="muted">No activity yet — start checking in and logging Quran activity.</p>
      ) : (
        CATEGORIES.filter((c) => c.key !== 'overall').map((c) => {
          const score = scores[c.key] ?? 0;
          const badge = badgeFor(score);
          return (
            <div key={c.key} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--slate-100)', color: 'var(--slate-800)' }}>
                {c.icon}
              </div>
              <div className="leader-name">
                {c.label}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {score} {c.unit}
                </div>
              </div>
              {badge ? (
                <span className="badge">
                  {badge.icon} {badge.label}
                </span>
              ) : (
                <span className="pill warn">No badge yet</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function TelegramCard() {
  const { user, refreshUser } = useAuth();
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function generateLink() {
    setError('');
    setBusy(true);
    try {
      const res = await api.telegramLinkToken();
      setLink(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setError('');
    setBusy(true);
    try {
      await api.telegramUnlink();
      setLink(null);
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">Telegram login</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Telegram is the main way to sign in — your login codes arrive instantly and free, with no
        SMS charges.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {user?.telegramLinked ? (
        <>
          <div className="alert alert-success">
            ✅ Linked{user.telegramUsername ? ` as @${user.telegramUsername}` : ''}
          </div>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={unlink}>
            Unlink Telegram
          </button>
        </>
      ) : link ? (
        <>
          <div className="alert alert-info">
            Open Telegram and tap the link below, then press <strong>Start</strong>.
          </div>
          <a
            className="btn btn-block"
            style={{ display: 'block', textAlign: 'center' }}
            href={link.linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Telegram
          </a>
          <p className="muted" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            Or send <code>/start {link.token}</code> to @{link.botUsername}
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 10 }}
            onClick={refreshUser}
          >
            I've linked it — refresh
          </button>
        </>
      ) : (
        <button className="btn btn-block" disabled={busy} onClick={generateLink}>
          {busy ? 'Generating…' : 'Link Telegram'}
        </button>
      )}
    </div>
  );
}

/**
 * Edit the member's own details. Address is editable here so existing members
 * (who registered before it was required) can fill it in.
 */
function DetailsCard() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({
    fullName: user?.fullName || '',
    birthDate: user?.birthDate || '',
    gender: user?.gender || '',
    address: user?.address || '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-sync if the user object changes (e.g. after a refresh elsewhere).
  useEffect(() => {
    setForm({
      fullName: user?.fullName || '',
      birthDate: user?.birthDate || '',
      gender: user?.gender || '',
      address: user?.address || '',
    });
  }, [user?.id, user?.fullName, user?.birthDate, user?.gender, user?.address]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.updateProfile({
        fullName: form.fullName,
        birthDate: form.birthDate,
        gender: form.gender,
        address: form.address,
      });
      await refreshUser();
      setNotice('Details saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2 className="card-title">My details</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Keep these up to date — the surau uses them for records and contact.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="field">
        <label htmlFor="pFullName">Full name</label>
        <input
          id="pFullName"
          value={form.fullName}
          onChange={(e) => update('fullName', e.target.value)}
          required
        />
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pBirthDate">Date of birth</label>
          <input
            id="pBirthDate"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={form.birthDate}
            onChange={(e) => update('birthDate', e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pGender">Gender</label>
          <select
            id="pGender"
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
        <label htmlFor="pAddress">Address</label>
        <AddressAutocomplete
          id="pAddress"
          value={form.address}
          onChange={(v) => update('address', v)}
          required
          placeholder="e.g. No 12, Jalan Cerdik, Taman Universiti"
        />
      </div>

      <button className="btn btn-block" disabled={busy}>
        {busy ? 'Saving…' : 'Save details'}
      </button>
    </form>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [history, setHistory] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.familyAttendance(60), api.listDependents()])
      .then(([data, deps]) => {
        setHistory(data.attendance);
        setDependents(deps.dependents);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      <p className="page-sub">Your account and attendance history.</p>

      <div className="card" data-tour="profile-card">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: '1.1rem' }}>{user?.fullName}</strong>
            <div className="muted">{user?.phone}</div>
          </div>
          <span className="pill">{ROLE_LABELS[user?.role] || 'Member'}</span>
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className={`pill ${user?.hasFace ? '' : 'warn'}`}>
            {user?.hasFace ? '✅ Face enrolled' : '⚠️ No face enrolled'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-sm btn-secondary" to="/register">
            {user?.hasFace ? 'Re-enroll face' : 'Enroll face'}
          </Link>
          <TourButton />
          <button className="btn btn-sm btn-danger" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2 className="card-title">👨‍👩‍👧 Family</h2>
          <Link className="pill" to="/family">
            Manage
          </Link>
        </div>
        <p className="muted" style={{ margin: '6px 0 12px' }}>
          Add your children so you can check them in for prayers — they don't need their own phone.
        </p>
        {dependents.length === 0 ? (
          <p className="muted">No dependents added yet.</p>
        ) : (
          dependents.map((dep) => (
            <div key={dep.id} className="leader-row">
              <div className="leader-name">
                {dep.fullName}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {ageLabel(dep.birthDate)}
                </div>
              </div>
              <span className={`pill ${dep.hasFace ? '' : 'warn'}`}>
                {dep.hasFace ? 'face ✓' : 'no face'}
              </span>
            </div>
          ))
        )}
      </div>

      <TelegramCard />

      <DetailsCard />

      <BadgesCard />

      <div className="card">
        <h2 className="card-title">🕌 {SURAU.name}</h2>
        <p className="muted" style={{ margin: '6px 0' }}>{SURAU.address}</p>
        <a href={SURAU.mapsUrl} target="_blank" rel="noreferrer">
          {SURAU.latitude}° N, {SURAU.longitude}° E — Open in Maps
        </a>
      </div>

      <div className="card">
        <h2 className="card-title">Attendance history</h2>
        <p className="muted" style={{ marginBottom: 12 }}>You and your dependents — most recent 60 records</p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No attendance yet. Start checking in!</p>
        ) : (
          history.map((row) => (
            <div key={row.id} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--teal-100)', color: 'var(--teal-900)' }}>
                {PRAYER_LABELS[row.prayer]?.[0]}
              </div>
              <div className="leader-name">
                {PRAYER_LABELS[row.prayer]}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {row.guardian_id ? `${row.full_name} · ` : ''}
                  {formatDate(row.attendance_date)}
                </div>
              </div>
              <span className="pill">{row.method}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}