import { config } from '../config.js';
import { query } from '../db.js';
import { getPrayerTimes, PRAYER_KEYS } from './prayerTimes.js';
import { nextOccurrence } from './recurrence.js';
import { dateInTz } from './timezone.js';
import {
  createNotification,
  deliverPending,
  pruneOldNotifications,
  formatTimeInTz,
  formatWhenInTz,
  PRAYER_LABELS,
} from './notify.js';

/**
 * Notification scheduler.
 *
 * Runs every NOTIFICATIONS_TICK_MS (default 60s) and does three things:
 *   1. Prayer reminders  — one per user per prayer, fired at adhan - lead.
 *      Skips members who already checked in for that prayer (no nagging).
 *   2. Program reminders — for members who JOINED a program, fired
 *      programLeadHours before its next occurrence.
 *   3. Delivery + pruning — pushes pending rows to Telegram/Web Push and
 *      trims the in-app feed past retention.
 *
 * All creation goes through createNotification()'s ON CONFLICT dedupe, so a
 * restart, overlap or double-tick is harmless: rows are only made once.
 */

let timer = null;
let running = false;

export function startScheduler() {
  if (timer) return;
  const { tickMs } = config.notifications;
  timer = setInterval(() => {
    // Skip a tick entirely if the previous one is still running (e.g. Aladhan
    // slow + Telegram rate-limited) rather than piling up.
    if (running) return;
    running = true;
    tick()
      .catch((err) => console.error('[scheduler] tick failed:', err.message))
      .finally(() => {
        running = false;
      });
  }, tickMs);
  console.log(`[scheduler] started (every ${Math.round(tickMs / 1000)}s)`);
  // First tick shortly after boot so reminders resume quickly on restart.
  setTimeout(() => {
    if (running) return;
    running = true;
    tick()
      .catch((err) => console.error('[scheduler] tick failed:', err.message))
      .finally(() => {
        running = false;
      });
  }, 15_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * One scheduler pass. Exported so it can be triggered/tested manually
 * (e.g. `node -e "import('./src/utils/scheduler.js').then(m => m.tick())"`).
 */
export async function tick(now = new Date()) {
  await prayerReminders(now);
  await programReminders(now);
  await deliverPending();
  // Prune at most once an hour (on the tick closest to the hour boundary).
  if (now.getMinutes() < 1) await pruneOldNotifications();
}

/**
 * Active members with prayer reminders on who can actually LOG IN and act on
 * a reminder: excludes phone-less dependents (no login, unreachable) but
 * KEEPS promoted children (guardian_id set but they own a phone).
 */
async function prayerReminderAudience() {
  const { rows } = await query(
    `SELECT u.id
     FROM users u
     LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.is_active = TRUE
       AND u.is_dummy = FALSE
       AND (u.guardian_id IS NULL OR u.phone IS NOT NULL)
       AND COALESCE(p.prayer_reminders, TRUE) = TRUE`,
  );
  return rows.map((r) => r.id);
}

async function prayerReminders(now) {
  const lead = config.notifications.prayerLeadMinutes * 60 * 1000;
  const tz = config.prayer.timezone;

  // Today's prayers; Subuh's reminder can also land "yesterday evening" only
  // if lead > time between Isyak and Subuh, which it never is — one day is enough.
  let times;
  try {
    times = await getPrayerTimes(dateInTz(now, tz));
  } catch (err) {
    // Prayer times unreachable — skip this tick, try again next one.
    console.warn(`[scheduler] prayer times unavailable, skipping reminders: ${err.message}`);
    return;
  }

  const due = PRAYER_KEYS.filter((key) => {
    const remindAt = times[key].getTime() - lead;
    // Fire within a window [remindAt, adhan): early ticks are ok (deduped),
    // late ones would be stale ("in 15 minutes" for an adhan that passed).
    return now.getTime() >= remindAt && now.getTime() < times[key].getTime();
  });
  if (!due.length) return;

  const audience = await prayerReminderAudience();
  if (!audience.length) return;

  const date = dateInTz(now, tz);
  for (const prayer of due) {
    // Don't nag members who already prayed — check attendance first.
    const { rows: checkedRows } = await query(
      `SELECT u.id FROM unnest($1::uuid[]) AS u(id)
       WHERE EXISTS (
         SELECT 1 FROM attendance a
         WHERE a.user_id = u.id AND a.prayer = $2 AND a.attendance_date = $3
       )`,
      [audience, prayer, date],
    );
    const checkedIn = new Set(checkedRows.map((r) => r.id));
    const adhan = times[prayer];

    for (const userId of audience) {
      if (checkedIn.has(userId)) continue;
      await createNotification({
        userId,
        kind: 'prayer',
        title: `${PRAYER_LABELS[prayer]} in ${config.notifications.prayerLeadMinutes} minutes`,
        body: `Adhan at ${formatTimeInTz(adhan)}. Come to the surau and check in when you arrive.`,
        link: '/check-in',
        dedupeKey: `prayer:${date}:${prayer}`,
      });
    }
  }
}

async function programReminders(now) {
  const leadMs = config.notifications.programLeadHours * 60 * 60 * 1000;

  // Published programs that could start within the lead window. One-off:
  // starts_at in (now, now + lead]. Recurring: still active (until not passed).
  const { rows: programs } = await query(
    `SELECT * FROM programs
     WHERE is_published = TRUE
       AND (
         (recurrence_days = '{}' AND starts_at > $1 AND starts_at <= $2)
         OR
         (recurrence_days <> '{}' AND (recurrence_until IS NULL OR recurrence_until >= CURRENT_DATE))
       )`,
    [now, new Date(now.getTime() + leadMs)],
  );

  for (const program of programs) {
    const recurring = Array.isArray(program.recurrence_days) && program.recurrence_days.length > 0;
    let start;
    let sessionKey;
    if (recurring) {
      const occ = await nextOccurrence(program, now);
      if (!occ) continue;
      // Only remind when the next occurrence itself falls inside the window.
      if (occ.start.getTime() - now.getTime() > leadMs) continue;
      start = occ.start;
      sessionKey = occ.date;
    } else {
      start = new Date(program.starts_at);
      sessionKey = 'once';
    }

    // Audience: members who explicitly joined this program and can log in
    // (phone-less dependents can't see an in-app feed and have no channels).
    const { rows: joined } = await query(
      `SELECT pa.user_id
       FROM program_attendance pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN notification_prefs p ON p.user_id = pa.user_id
       WHERE pa.program_id = $1
         AND u.is_active = TRUE
         AND u.is_dummy = FALSE
         AND (u.guardian_id IS NULL OR u.phone IS NOT NULL)
         AND COALESCE(p.program_reminders, TRUE) = TRUE`,
      [program.id],
    );

    for (const { user_id: userId } of joined) {
      await createNotification({
        userId,
        kind: 'program',
        title: `${program.title} — ${formatWhenInTz(start, now)}`,
        body: program.location ? `At ${program.location}.` : 'See you there!',
        link: '/programs',
        dedupeKey: `program:${program.id}:${sessionKey}`,
      });
    }
  }
}
