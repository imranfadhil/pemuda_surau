import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import DataTable from './DataTable.jsx';
import MemberPicker from './MemberPicker.jsx';
import {
  formatDateTime,
  formatDate,
  SURAU,
  WEEKDAYS,
  PRAYERS,
  describeRecurrenceDays,
  describeRecurrenceTime,
} from '../lib/constants.js';
import { fileToPosterDataUrl, dataUrlBytes } from '../lib/poster.js';

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
  posterUrl: '',
  links: [],
  recurring: false,
  recurrenceDays: [],
  recurrenceUntil: '',
  recurrenceStartMode: 'prayer',
  recurrenceStartTime: '19:30',
  recurrenceStartPrayer: 'maghrib',
  recurrenceStartOffsetMinutes: 0,
  recurrenceEndMode: 'prayer',
  recurrenceEndTime: '21:00',
  recurrenceEndPrayer: 'isyak',
  recurrenceEndOffsetMinutes: 0,
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
    posterUrl: p.poster_url || '',
    links: Array.isArray(p.links) ? p.links : [],
    recurring: Boolean(p.is_recurring),
    recurrenceDays: Array.isArray(p.recurrence_days) ? p.recurrence_days : [],
    recurrenceUntil: p.recurrence_until ? String(p.recurrence_until).slice(0, 10) : '',
    recurrenceStartMode: p.recurrence_start_mode || 'prayer',
    recurrenceStartTime: p.recurrence_start_time || '19:30',
    recurrenceStartPrayer: p.recurrence_start_prayer || 'maghrib',
    recurrenceStartOffsetMinutes: p.recurrence_start_offset_minutes ?? 0,
    recurrenceEndMode: p.recurrence_end_mode || 'prayer',
    recurrenceEndTime: p.recurrence_end_time || '21:00',
    recurrenceEndPrayer: p.recurrence_end_prayer || 'isyak',
    recurrenceEndOffsetMinutes: p.recurrence_end_offset_minutes ?? 0,
  };
}

/** Turn the form state into the API payload (shared by create and update). */
function toPayload(form) {
  const recurring = form.recurring && form.recurrenceDays.length > 0;
  return {
    title: form.title,
    description: form.description || null,
    location: form.location || null,
    // A recurring program derives its times from the rule, so it needs no
    // single start/end instant.
    startsAt: recurring ? null : new Date(form.startsAt).toISOString(),
    endsAt: recurring || !form.endsAt ? null : new Date(form.endsAt).toISOString(),
    category: form.category || 'program',
    isPublished: form.isPublished,
    latitude: form.useOwnLocation && form.latitude !== '' ? Number(form.latitude) : null,
    longitude: form.useOwnLocation && form.longitude !== '' ? Number(form.longitude) : null,
    radiusMeters:
      form.useOwnLocation && form.radiusMeters !== '' ? Number(form.radiusMeters) : null,
    checkInGraceMinutes: Number(form.checkInGraceMinutes) || 0,
    checkInEnabled: form.checkInEnabled,
    posterUrl: form.posterUrl || null,
    links: form.links.filter((l) => l.label && l.url),
    recurrenceDays: recurring ? form.recurrenceDays : [],
    recurrenceUntil: recurring && form.recurrenceUntil ? form.recurrenceUntil : null,
    recurrenceStartMode: form.recurrenceStartMode,
    recurrenceStartTime: form.recurrenceStartMode === 'fixed' ? form.recurrenceStartTime : null,
    recurrenceStartPrayer: form.recurrenceStartMode === 'prayer' ? form.recurrenceStartPrayer : null,
    recurrenceStartOffsetMinutes: Number(form.recurrenceStartOffsetMinutes) || 0,
    recurrenceEndMode: form.recurrenceEndMode,
    recurrenceEndTime: form.recurrenceEndMode === 'fixed' ? form.recurrenceEndTime : null,
    recurrenceEndPrayer: form.recurrenceEndMode === 'prayer' ? form.recurrenceEndPrayer : null,
    recurrenceEndOffsetMinutes: Number(form.recurrenceEndOffsetMinutes) || 0,
  };
}

function ProgramForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial ? formFromProgram(initial) : EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);

  function set(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function toggleDay(key) {
    setForm((f) => ({
      ...f,
      recurrenceDays: f.recurrenceDays.includes(key)
        ? f.recurrenceDays.filter((d) => d !== key)
        : [...f.recurrenceDays, key],
    }));
  }

  function setLink(index, patch) {
    setForm((f) => ({
      ...f,
      links: f.links.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  }

  function addLink() {
    setForm((f) => ({ ...f, links: [...f.links, { label: '', url: '' }] }));
  }

  function removeLink(index) {
    setForm((f) => ({ ...f, links: f.links.filter((_, i) => i !== index) }));
  }

  async function onPosterChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setPosterBusy(true);
    try {
      const dataUrl = await fileToPosterDataUrl(file);
      set({ posterUrl: dataUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setPosterBusy(false);
      e.target.value = '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.recurring && form.recurrenceDays.length === 0) {
      setError('Pick at least one day for a recurring program.');
      return;
    }
    if (!form.recurring && !form.startsAt) {
      setError('A start time is required.');
      return;
    }
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

  const posterKb = form.posterUrl ? Math.round(dataUrlBytes(form.posterUrl) / 1024) : 0;

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card-title">{initial ? 'Edit program' : 'New program'}</h2>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="field" style={{ marginTop: 12 }}>
        <label>Title</label>
        <input
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          required
        />
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      {/* Poster */}
      <div className="field">
        <label>Poster</label>
        {form.posterUrl ? (
          <div className="poster-preview">
            <img src={form.posterUrl} alt="Program poster preview" />
            <div className="poster-preview-actions">
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {posterKb} KB
              </span>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => set({ posterUrl: '' })}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <input type="file" accept="image/*" onChange={onPosterChange} disabled={posterBusy} />
        )}
        {posterBusy && <p className="muted">Processing image…</p>}
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          Images are resized automatically before saving.
        </p>
      </div>

      {/* Links */}
      <div className="field">
        <label>Links</label>
        {form.links.map((link, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <input
              style={{ flex: 1 }}
              placeholder="Label (e.g. WhatsApp group)"
              value={link.label}
              onChange={(e) => setLink(i, { label: e.target.value })}
            />
            <input
              style={{ flex: 2 }}
              placeholder="https://…"
              value={link.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => removeLink(i)}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-secondary" onClick={addLink}>
          + Add link
        </button>
      </div>

      {/* Recurrence */}
      <label className="check-row">
        <input
          type="checkbox"
          checked={form.recurring}
          onChange={(e) => set({ recurring: e.target.checked })}
        />
        Repeats weekly
      </label>

      {form.recurring ? (
        <div className="recurrence-box">
          <div className="field">
            <label>Days</label>
            <div className="day-picker">
              {WEEKDAYS.map((d) => (
                <button
                  type="button"
                  key={d.key}
                  className={`day-chip ${form.recurrenceDays.includes(d.key) ? 'active' : ''}`}
                  onClick={() => toggleDay(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Starts</label>
              <select
                value={form.recurrenceStartMode}
                onChange={(e) => set({ recurrenceStartMode: e.target.value })}
              >
                <option value="prayer">At a prayer</option>
                <option value="fixed">At a fixed time</option>
              </select>
            </div>
            {form.recurrenceStartMode === 'prayer' ? (
              <>
                <div className="field" style={{ flex: 1 }}>
                  <label>Prayer</label>
                  <select
                    value={form.recurrenceStartPrayer}
                    onChange={(e) => set({ recurrenceStartPrayer: e.target.value })}
                  >
                    {PRAYERS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Offset (min)</label>
                  <input
                    type="number"
                    value={form.recurrenceStartOffsetMinutes}
                    onChange={(e) => set({ recurrenceStartOffsetMinutes: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="field" style={{ flex: 1 }}>
                <label>Time</label>
                <input
                  type="time"
                  value={form.recurrenceStartTime}
                  onChange={(e) => set({ recurrenceStartTime: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Ends</label>
              <select
                value={form.recurrenceEndMode}
                onChange={(e) => set({ recurrenceEndMode: e.target.value })}
              >
                <option value="prayer">At a prayer</option>
                <option value="fixed">At a fixed time</option>
              </select>
            </div>
            {form.recurrenceEndMode === 'prayer' ? (
              <>
                <div className="field" style={{ flex: 1 }}>
                  <label>Prayer</label>
                  <select
                    value={form.recurrenceEndPrayer}
                    onChange={(e) => set({ recurrenceEndPrayer: e.target.value })}
                  >
                    {PRAYERS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Offset (min)</label>
                  <input
                    type="number"
                    value={form.recurrenceEndOffsetMinutes}
                    onChange={(e) => set({ recurrenceEndOffsetMinutes: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="field" style={{ flex: 1 }}>
                <label>Time</label>
                <input
                  type="time"
                  value={form.recurrenceEndTime}
                  onChange={(e) => set({ recurrenceEndTime: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label>Repeat until (optional)</label>
            <input
              type="date"
              value={form.recurrenceUntil}
              onChange={(e) => set({ recurrenceUntil: e.target.value })}
            />
          </div>

          <p className="muted" style={{ fontSize: '0.8rem' }}>
            {describeRecurrenceDays(form.recurrenceDays) || 'Pick days above'} ·{' '}
            {describeRecurrenceTime(
              form.recurrenceStartMode,
              form.recurrenceStartTime,
              form.recurrenceStartPrayer,
              form.recurrenceStartOffsetMinutes,
            )}{' '}
            –{' '}
            {describeRecurrenceTime(
              form.recurrenceEndMode,
              form.recurrenceEndTime,
              form.recurrenceEndPrayer,
              form.recurrenceEndOffsetMinutes,
            )}
          </p>
        </div>
      ) : (
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Starts at</label>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
              required
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Ends at</label>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Location</label>
          <input
            value={form.location}
            onChange={(e) => set({ location: e.target.value })}
            placeholder="e.g. Surau main hall"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <input
            value={form.category}
            onChange={(e) => set({ category: e.target.value })}
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
            onChange={(e) => set({ checkInGraceMinutes: e.target.value })}
          />
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.checkInEnabled}
          onChange={(e) => set({ checkInEnabled: e.target.checked })}
        />
        Allow members to check in (face scan + geofence)
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.isPublished}
          onChange={(e) => set({ isPublished: e.target.checked })}
        />
        Published (visible to members)
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={form.useOwnLocation}
          onChange={(e) => set({ useOwnLocation: e.target.checked })}
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
                onChange={(e) => set({ latitude: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => set({ longitude: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Radius (m)</label>
              <input
                type="number"
                min="10"
                value={form.radiusMeters}
                onChange={(e) => set({ radiusMeters: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" disabled={busy || posterBusy}>
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
  const [sessionDate, setSessionDate] = useState(program.session_date || '');
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
      await api.manualProgramCheckIn(program.id, manualId, sessionDate || undefined);
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
      await api.undoProgramCheckIn(program.id, row.userId, row.sessionDate || undefined);
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
      ...(program.is_recurring
        ? [
            {
              key: 'sessionDate',
              label: 'Session',
              sortable: true,
              render: (r) => (r.sessionDate ? formatDate(r.sessionDate) : '—'),
            },
          ]
        : []),
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
    [program.id, program.is_recurring],
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
            {program.is_recurring
              ? `${program.recurrence_summary || 'Recurring'} · ${formatDateTime(program.next_start)}`
              : formatDateTime(program.starts_at)}
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
        {program.is_recurring && (
          <div className="field">
            <label>Session date</label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
            />
            <p className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
              Leave blank to use the current or next session.
            </p>
          </div>
        )}
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
          const isPast = !p.is_recurring && new Date(p.check_in_closes_at) < new Date();
          return (
            <div className="card" key={p.id}>
              <div className="program-card">
                {p.poster_url ? (
                  <img className="program-poster-thumb" src={p.poster_url} alt="" />
                ) : (
                  <div
                    className="program-date"
                    style={isPast ? { background: 'var(--slate-400)' } : undefined}
                  >
                    <div className="day">{start.getDate()}</div>
                    <div className="mon">
                      {start.toLocaleDateString(undefined, { month: 'short' })}
                    </div>
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div className="row-between">
                    <strong>{p.title}</strong>
                    <div className="row" style={{ gap: 6 }}>
                      {!p.is_published && <span className="pill warn">Draft</span>}
                      {p.is_recurring && <span className="pill">🔁 Recurring</span>}
                      {p.is_open && <span className="pill">Check-in open</span>}
                      {!p.check_in_enabled && <span className="pill warn">Check-in off</span>}
                    </div>
                  </div>
                  <div className="muted" style={{ margin: '4px 0' }}>
                    {p.is_recurring
                      ? `${p.recurrence_summary || 'Recurring'} · next ${formatDateTime(p.next_start)}`
                      : formatDateTime(p.starts_at)}
                    {!p.is_recurring && p.ends_at ? ` – ${formatDateTime(p.ends_at)}` : ''}
                    {p.location ? ` · ${p.location}` : ''}
                  </div>
                  {p.description && (
                    <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>{p.description}</p>
                  )}
                  {p.links?.length > 0 && (
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                      {p.links.map((l, i) => (
                        <a
                          key={i}
                          className="pill"
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          🔗 {l.label}
                        </a>
                      ))}
                    </div>
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
