import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import {
  PRAYERS, PRAYER_LABELS, todayISO, formatDate, ROLES, ROLE_LABELS, can,
} from '../lib/constants.js';

/**
 * Admin / Staff page.
 *
 * Quran and Merits now have their own tabs in the bottom nav, so this page
 * covers member management and attendance only.
 */
export default function AdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canAttendance = can(user, 'manageAttendance');

  const [tab, setTab] = useState(isAdmin ? 'members' : 'attendance');
  const [users, setUsers] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [dayAttendance, setDayAttendance] = useState([]);
  const [error, setError] = useState('');
  const [manual, setManual] = useState({ userId: '', prayer: 'subuh', date: todayISO() });
  const [notice, setNotice] = useState('');
  const [loginCode, setLoginCode] = useState(null);
  const [codeBusy, setCodeBusy] = useState('');

  function loadUsers() {
    api.listUsers().then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }

  function loadDay() {
    api.attendanceByDate(date).then((d) => setDayAttendance(d.attendance)).catch((e) => setError(e.message));
  }

  useEffect(loadUsers, []);
  useEffect(() => {
    if (canAttendance) loadDay();
  }, [date, canAttendance]);

  async function toggleActive(user) {
    try {
      await api.setUserActive(user.id, !user.isActive);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeRole(target, role) {
    setError('');
    setNotice('');
    try {
      await api.setUserRole(target.id, role);
      setNotice(`${target.fullName} is now ${ROLE_LABELS[role]}.`);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function generateCode(user) {
    setError('');
    setNotice('');
    setCodeBusy(user.id);
    try {
      const res = await api.generateLoginCode(user.id);
      setLoginCode(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setCodeBusy('');
    }
  }

  async function submitManual(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api.manualCheckIn(manual);
      setNotice('Manual check-in recorded.');
      loadDay();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1 className="page-title">{isAdmin ? 'Admin' : 'Staff'}</h1>
      <p className="page-sub">
        {isAdmin
          ? 'Manage members and attendance.'
          : `Signed in as ${ROLE_LABELS[user?.role] || 'staff'}.`}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {loginCode && (
        <div className="alert alert-success">
          <div className="row-between">
            <strong>Login code for {loginCode.fullName}</strong>
            <button className="btn btn-sm btn-secondary" onClick={() => setLoginCode(null)}>
              Dismiss
            </button>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.2em', margin: '8px 0' }}>
            {loginCode.code}
          </div>
          <div className="muted">
            Last resort — read this to {loginCode.fullName} ({loginCode.phone}). It expires in a few
            minutes. Prefer asking them to link Telegram instead.
          </div>
        </div>
      )}

      <div className="tab-row">
        {isAdmin && (
          <button className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>
            Members
          </button>
        )}
        {canAttendance && (
          <button className={`tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>
            Daily attendance
          </button>
        )}
        {canAttendance && (
          <button className={`tab ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}>
            Manual check-in
          </button>
        )}
      </div>

      {tab === 'members' && isAdmin && (
        <div className="card">
          <h2 className="card-title">Members ({users.length})</h2>
          <div style={{ marginTop: 12 }}>
            {users.map((u) => (
              <div key={u.id} className="leader-row">
                <div className="leader-name">
                  {u.fullName}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {u.phone || 'no phone (dependent)'}
                    {u.guardianName ? ` · child of ${u.guardianName}` : ''}
                  </div>
                </div>
                {u.isDependent ? (
                  <span className="pill">Dependent</span>
                ) : (
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value)}
                    style={{ width: 'auto' }}
                    title="Change role"
                  >
                    {ROLES.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
                <span className={`pill ${u.hasFace ? '' : 'warn'}`}>
                  {u.hasFace ? 'face ✓' : 'no face'}
                </span>
                <span className={`pill ${u.telegramLinked ? '' : 'warn'}`}>
                  {u.telegramLinked ? 'tg ✓' : 'no tg'}
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={codeBusy === u.id || !u.phone}
                  title={
                    u.phone
                      ? 'Last resort: generate a code to read out if the member cannot use Telegram'
                      : 'Dependents have no phone to log in with'
                  }
                  onClick={() => generateCode(u)}
                >
                  {codeBusy === u.id ? '…' : 'Code'}
                </button>
                <button
                  className={`btn btn-sm ${u.isActive ? 'btn-secondary' : ''}`}
                  onClick={() => toggleActive(u)}
                >
                  {u.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'attendance' && canAttendance && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="card-title">Attendance</h2>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </div>
          {dayAttendance.length === 0 ? (
            <p className="muted">No records for {formatDate(date)}.</p>
          ) : (
            dayAttendance.map((row) => (
              <div key={row.id} className="leader-row">
                <div className="rank-badge" style={{ background: 'var(--teal-100)', color: 'var(--teal-900)' }}>
                  {PRAYER_LABELS[row.prayer]?.[0]}
                </div>
                <div className="leader-name">
                  {row.full_name}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {PRAYER_LABELS[row.prayer]} · {row.phone || 'dependent'}
                    {row.guardian_name ? ` · child of ${row.guardian_name}` : ''}
                  </div>
                </div>
                <span className="pill">{row.method}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'manual' && canAttendance && (
        <form className="card" onSubmit={submitManual}>
          <h2 className="card-title">Manual check-in</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Record attendance on behalf of a member (e.g. if face verification failed).
          </p>
          <div className="field">
            <label>Member</label>
            <select
              value={manual.userId}
              onChange={(e) => setManual({ ...manual, userId: e.target.value })}
              required
            >
              <option value="">Select member…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} {u.phone ? `(${u.phone})` : '(dependent)'}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Prayer</label>
              <select
                value={manual.prayer}
                onChange={(e) => setManual({ ...manual, prayer: e.target.value })}
              >
                {PRAYERS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Date</label>
              <input
                type="date"
                value={manual.date}
                onChange={(e) => setManual({ ...manual, date: e.target.value })}
              />
            </div>
          </div>
          <button className="btn btn-block">Record check-in</button>
        </form>
      )}
    </div>
  );
}
