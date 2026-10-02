import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import DataTable from './DataTable.jsx';
import MemberPicker from './MemberPicker.jsx';
import { formatDateTime, SURAU } from '../lib/constants.js';

/** `datetime-local` inputs need a local-time string, not an ISO/UTC one. */
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

const EMPTY_FORM = {
  title: '',
  description: '',
  location: '',
  startsAt: '',
  endsAt: '',
  category: 'program',
  isPublished: true,
  useOwnLocation: false,
  latitude: '',
  longitude: '',
  radiusMeters: '',
  checkInGraceMinutes: 30,
  checkInEnabled: true,
};

function formFromProgram(p) {
  return {
    title: p.title || '',
    description: p.description || '',
    location: p.location || '',
    startsAt: toLocalInput(p.starts_at),
    endsAt: toLocalInput(p.ends_at),
    category: p.category || 'program',
    isPublished: p.is_published,
    useOwnLocation: p.latitude != null && p.longitude != null,
    latitude: p.latitude ?? '',
    longitude: p.longitude ?? '',
    radiusMeters: p.radius_meters ?? '',
    checkInGraceMinutes: p.check_in_grace_minutes ?? 30,
    checkInEnabled: p.check_in_enabled,
  };
}

/** Turn the form state into the API payload (shared by create and update). */
function toPayload(form) {
  return {
    title: form.title,
    description: form.description || null,
    location: form.location || null,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    category: form.category || 'program',
    isPublished: form.isPublished,
    latitude: form.useOwnLocation && form.latitude !== '' ? Number(form.latitude) : null,
    longitude: form.useOwnLocation && form.longitude !== '' ? Number(form.longitude) : null,
    radiusMeters:
      form.useOwnLocation && form.radiusMeters !== '' ? Number(form.radiusMeters) : null,
    checkInGraceMinutes: Number(form.checkInGraceMinutes) || 0,
    checkInEnabled: form.checkInEnabled,
  };
}

function ProgramForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial ? formFromProgram(initial) : EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = toPayload(form);
      if (initial) await api.updateProgram(initial.id, payload);
      else await api.createProgram(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card-title">{initial ? 'Edit program' : 'New program'}</h2>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="field" style={{ marginTop: 12 }}>
        <label>Title</label>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Starts at</label>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            required
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Ends at</label>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Location</label>
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="e.g. Surau main hall"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Check-in grace after end (minutes)</label>
          <input
            type="number"
            min="0"
            max="1440"
            value={form.checkInGraceMinutes}
            onChange={(e) => setForm({ ...form, checkInGraceMinutes: e.target.value })}
          />
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.checkInEnabled}
          onChange={(e) => setForm({ ...form, checkInEnabled: e.target.checked })}
        />
        Allow members to check in (face scan + geofence)
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.isPublished}
          onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
        />
        Published (visible to members)
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.useOwnLocation}
          onChange={(e) => setForm({ ...form, useOwnLocation: e.target.checked })}
        />
        Held somewhere other than the surau
      </label>

      {form.useOwnLocation && (
        <>
          <p className="muted" style={{ marginTop: -4 }}>
            Defaults to the surau ({SURAU.latitude}, {SURAU.longitude}) when left blank.
          </p>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Latitude</label>
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Radius (m)</label>
              <input
                type="number"
                min="10"
                value={form.radiusMeters}
                onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Create program'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Attendance roster for one program: who joined, who turned up. */
function ProgramRoster({ program, onBack }) {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [manualId, setManualId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .programAttendance(program.id)
      .then((d) => setRows(d.attendance))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [program.id]);
  useEffect(() => {
    api.listUsers().then((d) => setUsers(d.users)).catch(() => {});
  }, []);

  async function addManual(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!manualId) {
      setError('Please choose a member.');
      return;
    }
    try {
      await api.manualProgramCheckIn(program.id, manualId);
      setNotice('Attendance recorded.');
      setManualId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function undo(row) {
    if (!confirm(`Remove ${row.fullName}'s check-in?`)) return;
    setError('');
    try {
      await api.undoProgramCheckIn(program.id, row.userId);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'fullName',
        label: 'Member',
        sortable: true,
        render: (r) => (
          <div className="leader-name">
            {r.fullName}
            {r.isDependent && <span className="pill">child of {r.guardianName}</span>}
          </div>
        ),
      },
      {
        key: 'joinedAt',
        label: 'Joined',
        sortable: true,
        render: (r) => formatDateTime(r.joinedAt),
      },
      {
        key: 'checkedInAt',
        label: 'Checked in',
        sortable: true,
        render: (r) =>
          r.checkedInAt ? (
            formatDateTime(r.checkedInAt)
          ) : (
            <span className="pill warn">not yet</span>
          ),
      },
      {
        key: 'method',
        label: 'Method',
        sortable: true,
        render: (r) =>
          r.checkedInAt ? (
            <span className="pill">
              {r.method === 'manual' ? `manual${r.verifiedByName ? ` · ${r.verifiedByName}` : ''}` : 'face'}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        key: 'actions',
        label: '',
        render: (r) =>
          r.checkedInAt ? (
            <button className="btn btn-sm btn-secondary" onClick={() => undo(r)}>
              Undo
            </button>
          ) : null,
      },
    ],
    // `undo` closes over nothing that changes between renders.
    [program.id],
  );

  const checkedIn = rows.filter((r) => r.checkedInAt).length;

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>
            {program.title}
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {formatDateTime(program.starts_at)}
            {program.location ? ` · ${program.location}` : ''}
          </p>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{rows.length}</div>
          <div className="label">Joined</div>
        </div>
        <div className="stat">
          <div className="value">{checkedIn}</div>
          <div className="label">Checked in</div>
        </div>
        <div className="stat">
          <div className="value">{rows.length - checkedIn}</div>
          <div className="label">No-show</div>
        </div>
      </div>

      <form className="card" onSubmit={addManual}>
        <h3 className="card-title">Manual check-in</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Record attendance on behalf of a member (e.g. if face verification failed).
        </p>
        <div className="field">
          <label>Member</label>
          <MemberPicker
            value={manualId}
            emptyLabel="Select member…"
            placeholder="Search a member…"
            noResultsLabel="No members match that name."
            onChange={setManualId}
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
        <button className="btn">Record attendance</button>
      </form>

      <div className="card">
        <h3 className="card-title">Roster ({rows.length})</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.id}
            initialSort={{ key: 'fullName', dir: 'asc' }}
            searchPlaceholder="Search member, phone…"
            emptyMessage="Nobody has joined this program yet."
          />
        )}
      </div>
    </div>
  );
}

/**
 * Admin → Programs tab.
 *
 * Covers the full lifecycle: create/edit a program, publish or unpublish it,
 * and open its roster to see who joined versus who actually turned up.
 */
export default function ProgramsAdmin() {
  const [programs, setPrograms] = useState([]);
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // program | 'new' | null
  const [roster, setRoster] = useState(null); // program

  function load() {
    setLoading(true);
    api
      .listPrograms(includePast)
      .then((d) => setPrograms(d.programs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [includePast]);

  async function togglePublish(program) {
    setError('');
    try {
      await api.updateProgram(program.id, { isPublished: !program.is_published });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(program) {
    if (!confirm(`Delete "${program.title}"? This also removes its attendance records.`)) return;
    setError('');
    try {
      await api.deleteProgram(program.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (roster) {
    return <ProgramRoster program={roster} onBack={() => setRoster(null)} />;
  }

  if (editing) {
    return (
      <ProgramForm
        initial={editing === 'new' ? null : editing}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Programs ({programs.length})
        </h2>
        <button className="btn btn-sm" onClick={() => setEditing('new')}>
          + New program
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="tab-row">
        <button
          className={`tab ${!includePast ? 'active' : ''}`}
          onClick={() => setIncludePast(false)}
        >
          Current &amp; upcoming
        </button>
        <button
          className={`tab ${includePast ? 'active' : ''}`}
          onClick={() => setIncludePast(true)}
        >
          All
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : programs.length === 0 ? (
        <div className="card center muted">No programs yet.</div>
      ) : (
        programs.map((p) => {
          const start = new Date(p.starts_at);
          const isPast = new Date(p.check_in_closes_at) < new Date();
          return (
            <div className="card" key={p.id}>
              <div className="program-card">
                <div
                  className="program-date"
                  style={isPast ? { background: 'var(--slate-400)' } : undefined}
                >
                  <div className="day">{start.getDate()}</div>
                  <div className="mon">
                    {start.toLocaleDateString(undefined, { month: 'short' })}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="row-between">
                    <strong>{p.title}</strong>
                    <div className="row" style={{ gap: 6 }}>
                      {!p.is_published && <span className="pill warn">Draft</span>}
                      {p.is_open && <span className="pill">Check-in open</span>}
                      {!p.check_in_enabled && <span className="pill warn">Check-in off</span>}
                    </div>
                  </div>
                  <div className="muted" style={{ margin: '4px 0' }}>
                    {formatDateTime(p.starts_at)}
                    {p.ends_at ? ` – ${formatDateTime(p.ends_at)}` : ''}
                    {p.location ? ` · ${p.location}` : ''}
                  </div>
                  {p.description && (
                    <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>{p.description}</p>
                  )}
                  <div className="muted" style={{ fontSize: '0.78rem' }}>
                    {p.join_count} joined · {p.checked_in_count} checked in
                  </div>
                  <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={() => setRoster(p)}>
                      Roster
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => togglePublish(p)}>
                      {p.is_published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
