import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import DataTable from '../components/DataTable.jsx';
import MemberPicker from '../components/MemberPicker.jsx';
import {
  PRAYERS, PRAYER_LABELS, todayISO, formatDate, formatDateTime, ROLES, ROLE_LABELS, can,
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
    if (!manual.userId) {
      setError('Please choose a member.');
      return;
    }
    try {
      await api.manualCheckIn(manual);
      setNotice('Manual check-in recorded.');
      loadDay();
    } catch (err) {
      setError(err.message);
    }
  }

  // Member table columns. Kept in a memo because DataTable uses it as a
  // dependency for filtering/sorting.
  const memberColumns = useMemo(
    () => [
      {
        key: 'fullName',
        label: 'Name',
        sortable: true,
        render: (u) => (
          <div className="leader-name">
            {u.fullName}
            {u.guardianName ? (
              <div className="muted" style={{ fontWeight: 400 }}>
                child of {u.guardianName}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: 'phone',
        label: 'Phone',
        sortable: true,
        render: (u) => u.phone || <span className="muted">no phone</span>,
      },
      {
        key: 'role',
        label: 'Role',
        sortable: true,
        // Dependents inherit the guardian's role, so show a pill instead.
        render: (u) =>
          u.isDependent ? (
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
          ),
      },
      {
        key: 'hasFace',
        label: 'Face',
        sortable: true,
        render: (u) => (
          <span className={`pill ${u.hasFace ? '' : 'warn'}`}>{u.hasFace ? '✓' : 'no'}</span>
        ),
      },
      {
        key: 'telegramLinked',
        label: 'Telegram',
        sortable: true,
        render: (u) => (
          <span className={`pill ${u.telegramLinked ? '' : 'warn'}`}>
            {u.telegramLinked ? '✓' : 'no'}
          </span>
        ),
      },
      {
        key: 'createdAt',
        label: 'Registered',
        sortable: true,
        render: (u) => <span className="muted">{formatDate(u.createdAt)}</span>,
      },
      {
        key: 'isActive',
        label: 'Status',
        sortable: true,
        render: (u) => (
          <span className={`pill ${u.isActive ? '' : 'warn'}`}>
            {u.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        searchValue: () => '',
        render: (u) => (
          <div className="row-btns">
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
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [codeBusy],
  );

  // Daily attendance table columns.
  const attendanceColumns = useMemo(
    () => [
      {
        key: 'full_name',
        label: 'Member',
        sortable: true,
        render: (row) => (
          <div className="leader-name">
            {row.full_name}
            {row.guardian_name ? (
              <div className="muted" style={{ fontWeight: 400 }}>
                child of {row.guardian_name}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: 'prayer',
        label: 'Prayer',
        sortable: true,
        // Sort by the canonical order of prayers, not alphabetically.
        sortValue: (row) => PRAYERS.findIndex((p) => p.key === row.prayer),
        render: (row) => PRAYER_LABELS[row.prayer] || row.prayer,
      },
      {
        key: 'phone',
        label: 'Phone',
        sortable: true,
        render: (row) => row.phone || <span className="muted">dependent</span>,
      },
      {
        key: 'method',
        label: 'Method',
        sortable: true,
        render: (row) => <span className="pill">{row.method}</span>,
      },
      {
        key: 'checked_in_at',
        label: 'Checked in',
        sortable: true,
        sortValue: (row) => (row.checked_in_at ? new Date(row.checked_in_at).getTime() : null),
        render: (row) => <span className="muted">{formatDateTime(row.checked_in_at)}</span>,
      },
    ],
    [],
  );


  return (
    <div>
      <h1 className="page-title">{isAdmin ? 'Admin' : 'Staff'}</h1>
      <p className="page-sub">
        {isAdmin
          ? 'Manage members and attendance.'
          : `Signed in as ${ROLE_LABELS[user?.role] || 'staff'}.`}
      </p>

      {isAdmin && (
        <p className="muted" style={{ marginTop: -8 }}>
          <Link to="/api-docs">📘 API reference</Link>
        </p>
      )}

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
          <DataTable
            columns={memberColumns}
            rows={users}
            getRowKey={(u) => u.id}
            initialSort={{ key: 'createdAt', dir: 'desc' }}
            searchPlaceholder="Search name, phone, role…"
            emptyMessage="No members yet."
          />
        </div>
      )}

      {tab === 'attendance' && canAttendance && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="card-title">Attendance ({dayAttendance.length})</h2>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </div>
          <DataTable
            columns={attendanceColumns}
            rows={dayAttendance}
            getRowKey={(row) => row.id}
            initialSort={{ key: 'full_name', dir: 'asc' }}
            searchPlaceholder="Search member, phone, prayer…"
            emptyMessage={`No records for ${formatDate(date)}.`}
          />
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
            <MemberPicker
              value={manual.userId}
              emptyLabel="Select member…"
              placeholder="Search a member…"
              noResultsLabel="No members match that name."
              onChange={(id) => setManual({ ...manual, userId: id })}
              options={users.map((u) => ({
                value: u.id,
                label: u.fullName,
                sublabel: u.phone || 'dependent',
                searchText: [u.phone, u.guardianName, u.isDependent ? 'dependent child' : '']
                  .filter(Boolean)
                  .join(' '),
              }))}
            />
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
