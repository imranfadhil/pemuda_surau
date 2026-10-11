import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { pushSupport, pushNeedsInstall, subscribePush, unsubscribePush } from '../lib/push.js';

/**
 * Top-bar notification bell.
 *
 * Shows the in-app feed (prayer + program reminders) with an unread badge,
 * a prefs panel (what to remind about + which channels), and a Web Push
 * enable toggle for this device.
 *
 * Polling is deliberately dumb: refetch on open + every 60s while logged in.
 * The feed is small and a minute of latency on an unread badge is fine.
 */

const FEED_LIMIT = 20;

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState(null);
  const [push, setPush] = useState({ supported: false, needsInstall: false, devices: 0 });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const panelRef = useRef(null);

  const refreshFeed = useCallback(async () => {
    try {
      const data = await api.notifications(FEED_LIMIT);
      setItems(data.notifications);
      setUnread(data.unread);
    } catch {
      /* non-fatal — the bell just stays on the last known state */
    }
  }, []);

  useEffect(() => {
    refreshFeed();
    const timer = setInterval(refreshFeed, 60_000);
    return () => clearInterval(timer);
  }, [refreshFeed]);

  useEffect(() => {
    if (!open) return undefined;
    api.notificationPrefs().then(setPrefs).catch(() => {});
    api
      .pushStatus()
      .then((s) =>
        setPush({
          supported: pushSupport(),
          needsInstall: pushNeedsInstall(),
          configured: Boolean(s.configured),
          devices: s.devices,
        }),
      )
      .catch(() => {});
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function togglePref(key) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic
    try {
      setPrefs(await api.updateNotificationPrefs({ [key]: next[key] }));
    } catch (err) {
      setPrefs(prefs); // roll back
      setPushError(err.message);
    }
  }

  async function enablePush() {
    setPushError('');
    setPushBusy(true);
    try {
      const status = await api.pushStatus();
      if (!status.configured) {
        setPushError('Web Push is not enabled on this server yet.');
        return;
      }
      const subscription = await subscribePush(status.publicKey);
      await api.pushSubscribe(subscription);
      setPush((p) => ({ ...p, devices: p.devices + 1 }));
    } catch (err) {
      setPushError(err.code === 'PERMISSION_DENIED' ? 'Notifications are blocked in your browser settings.' : err.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushError('');
    setPushBusy(true);
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await api.pushUnsubscribe(endpoint);
      setPush((p) => ({ ...p, devices: Math.max(0, p.devices - 1) }));
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function openItem(item) {
    setOpen(false);
    if (!item.readAt) {
      try {
        await api.markNotificationsRead([item.id]);
        refreshFeed();
      } catch {
        /* unread badge is cosmetic — don't block navigation */
      }
    }
    if (item.link) navigate(item.link);
  }

  async function markAllRead() {
    try {
      await api.markNotificationsRead();
      refreshFeed();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="notif-bell" ref={panelRef}>
      <button
        className="notif-bell-btn"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn-ghost notif-readall" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-list">
            {items.length === 0 ? (
              <p className="muted notif-empty">
                Nothing yet — prayer and program reminders will appear here.
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  className={`notif-item ${item.readAt ? '' : 'unread'}`}
                  onClick={() => openItem(item)}
                >
                  <span className="notif-item-icon">{item.kind === 'prayer' ? '🕌' : '📅'}</span>
                  <span className="notif-item-body">
                    <span className="notif-item-title">{item.title}</span>
                    {item.body && <span className="notif-item-text">{item.body}</span>}
                    <span className="notif-item-time">{timeAgo(item.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="notif-prefs">
            <div className="notif-prefs-title">Remind me about</div>
            <label className="notif-toggle">
              <input
                type="checkbox"
                disabled={!prefs}
                checked={Boolean(prefs?.prayerReminders)}
                onChange={() => togglePref('prayerReminders')}
              />
              Prayers (15 min before adhan)
            </label>
            <label className="notif-toggle">
              <input
                type="checkbox"
                disabled={!prefs}
                checked={Boolean(prefs?.programReminders)}
                onChange={() => togglePref('programReminders')}
              />
              Programs I joined (day before)
            </label>

            <div className="notif-prefs-title" style={{ marginTop: 10 }}>
              How to reach me
            </div>
            <label className="notif-toggle">
              <input
                type="checkbox"
                disabled={!prefs}
                checked={Boolean(prefs?.telegramEnabled)}
                onChange={() => togglePref('telegramEnabled')}
              />
              Telegram
            </label>

            {push.supported && push.configured ? (
              push.devices > 0 ? (
                <button className="btn btn-secondary btn-sm" disabled={pushBusy} onClick={disablePush}>
                  {pushBusy ? 'Turning off…' : '🔕 Turn off push on this device'}
                </button>
              ) : (
                <button className="btn btn-sm" disabled={pushBusy} onClick={enablePush}>
                  {pushBusy ? 'Enabling…' : '🔔 Enable push notifications'}
                </button>
              )
            ) : push.needsInstall ? (
              <p className="muted notif-hint">
                On iPhone, push needs the app installed: open the Share menu and choose “Add to
                Home Screen”.
              </p>
            ) : (
              <p className="muted notif-hint">
                Push notifications aren’t supported in this browser — Telegram will do.
              </p>
            )}
            {pushError && <div className="alert alert-error">{pushError}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
