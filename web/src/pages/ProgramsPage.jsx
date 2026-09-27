import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDateTime, can } from '../lib/constants.js';

function ProgramCard({ program, isAdmin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const start = new Date(program.starts_at);
  const isPast = start < new Date();

  async function togglePublish() {
    setBusy(true);
    try {
      await api.updateProgram(program.id, { isPublished: !program.is_published });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${program.title}"?`)) return;
    setBusy(true);
    try {
      await api.deleteProgram(program.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="program-card">
        <div className="program-date" style={isPast ? { background: 'var(--slate-400)' } : undefined}>
          <div className="day">{start.getDate()}</div>
          <div className="mon">{start.toLocaleDateString(undefined, { month: 'short' })}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="row-between">
            <strong>{program.title}</strong>
            {!program.is_published && <span className="pill warn">Draft</span>}
          </div>
          <div className="muted" style={{ margin: '4px 0' }}>
            {formatDateTime(program.starts_at)}
            {program.location ? ` · ${program.location}` : ''}
          </div>
          {program.description && (
            <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>{program.description}</p>
          )}
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {program.join_count} joined
          </div>
          {isAdmin && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={togglePublish}>
                {program.is_published ? 'Unpublish' : 'Publish'}
              </button>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProgramsPage() {
  const { user } = useAuth();
  const isAdmin = can(user, 'managePrograms');
  const [programs, setPrograms] = useState([]);
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    category: 'program',
  });

  function load() {
    setLoading(true);
    api
      .listPrograms(includePast)
      .then((data) => setPrograms(data.programs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [includePast]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createProgram({
        title: form.title,
        description: form.description || null,
        location: form.location || null,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        category: form.category || 'program',
      });
      setForm({ title: '', description: '', location: '', startsAt: '', endsAt: '', category: 'program' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="row-between">
        <div>
          <h1 className="page-title">Programs</h1>
          <p className="page-sub">Upcoming activities at the surau.</p>
        </div>
        {isAdmin && (
          <button className="btn btn-sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New'}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {isAdmin && showForm && (
        <form className="card" onSubmit={create}>
          <h2 className="card-title">New program</h2>
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
          <div className="field">
            <label>Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <button className="btn btn-block">Create program</button>
        </form>
      )}

      <div className="tab-row">
        <button className={`tab ${!includePast ? 'active' : ''}`} onClick={() => setIncludePast(false)}>
          Upcoming
        </button>
        <button className={`tab ${includePast ? 'active' : ''}`} onClick={() => setIncludePast(true)}>
          All
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : programs.length === 0 ? (
        <div className="card center muted">No programs yet.</div>
      ) : (
        programs.map((p) => (
          <ProgramCard key={p.id} program={p} isAdmin={isAdmin} onChanged={load} />
        ))
      )}
    </div>
  );
}