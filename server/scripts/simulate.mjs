/**
 * Simulation / seed script.
 *
 * Creates a realistic set of dummy members (teachers, AJK, youths) with three
 * months of backdated attendance, Quran activity and merits so the dashboard
 * and leaderboards can be demoed before go-live.
 *
 * Every account it creates is tagged `is_dummy = TRUE`, so it can be removed
 * cleanly later:
 *
 *   node scripts/simulate.mjs            # seed (replaces any previous dummy data)
 *   node scripts/simulate.mjs --clear    # remove all dummy data
 *
 * Run it inside the api container:
 *   docker compose exec -T api node scripts/simulate.mjs
 *   docker compose exec -T api node scripts/simulate.mjs --clear
 *
 * Tunables (env vars):
 *   SIM_TOTAL=60      total dummy members
 *   SIM_TEACHERS=5    how many are teachers
 *   SIM_AJK=10        how many are AJK / committee
 *   SIM_DAYS=90       how many days to backdate
 */

import { pool } from '../src/db.js';

const TOTAL = Number(process.env.SIM_TOTAL || 60);
const TEACHERS = Number(process.env.SIM_TEACHERS || 5);
const AJK = Number(process.env.SIM_AJK || 10);
const DAYS = Number(process.env.SIM_DAYS || 90);

const FIRST_NAMES = [
  'Ahmad', 'Muhammad', 'Abdul', 'Mohd', 'Amir', 'Hafiz', 'Iman', 'Irfan', 'Faiz', 'Firdaus',
  'Hakim', 'Haziq', 'Idris', 'Ilham', 'Imran', 'Iqbal', 'Ismail', 'Khairul', 'Luqman', 'Nabil',
  'Naufal', 'Ridzuan', 'Rizal', 'Shafiq', 'Syafiq', 'Umar', 'Yusuf', 'Zaid', 'Zikri', 'Aiman',
  'Aisyah', 'Aminah', 'Anis', 'Farah', 'Fatimah', 'Hana', 'Hidayah', 'Izzah', 'Khadijah', 'Liyana',
  'Maryam', 'Nadia', 'Nurul', 'Safiya', 'Salma', 'Siti', 'Sumayyah', 'Zahra', 'Zulaikha', 'Alya',
];

const LAST_NAMES = [
  'bin Abdullah', 'bin Ismail', 'bin Hassan', 'bin Omar', 'bin Yusof', 'bin Rahman', 'bin Karim',
  'bin Salleh', 'bin Zainal', 'bin Osman', 'binti Abdullah', 'binti Ismail', 'binti Hassan',
  'binti Omar', 'binti Yusof', 'binti Rahman', 'binti Karim', 'binti Salleh', 'binti Zainal',
  'binti Osman',
];

const MERIT_REASONS = [
  'Helped clean the surau',
  'Led the congregational prayer',
  'Helped organise a program',
  'Assisted an elderly member',
  'Volunteered during gotong-royong',
  'Helped teach Quran class',
  'Donated to the surau fund',
  'Welcomed new members',
  'Helped set up for an event',
  'Consistent attendance and good conduct',
];

const SURAHS = [
  'Al-Fatihah', 'Al-Baqarah', 'Ali Imran', 'An-Nisa', 'Al-Maidah', 'Al-Anam', 'Al-Araf',
  'Al-Kahf', 'Maryam', 'Ta-Ha', 'Al-Anbiya', 'Al-Hajj', 'Yasin', 'As-Saffat', 'Az-Zumar',
  'Ar-Rahman', 'Al-Waqiah', 'Al-Mulk', 'An-Naba', 'Al-Insan',
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Generate a unique display name (avoids duplicate rows on the leaderboard). */
function makeNameFactory() {
  const used = new Set();
  return function nextName() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    // Fallback: guarantee uniqueness with a numeric suffix.
    let n = used.size + 1;
    let name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${n}`;
    while (used.has(name)) {
      n += 1;
      name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${n}`;
    }
    used.add(name);
    return name;
  };
}

/** Remove every account tagged as dummy (cascades to their activity). */
async function clearDummy() {
  const { rowCount } = await pool.query('DELETE FROM users WHERE is_dummy = TRUE');
  console.log(`[simulate] removed ${rowCount} dummy user(s) and their activity.`);
}

async function seed() {
  // Start from a clean slate so re-running doesn't pile up duplicates.
  await clearDummy();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---- 1. Users ---------------------------------------------------------
    const nextName = makeNameFactory();
    const roles = [
      ...Array(TEACHERS).fill('teacher'),
      ...Array(AJK).fill('ajk'),
      ...Array(Math.max(0, TOTAL - TEACHERS - AJK)).fill('youth'),
    ];

    const users = roles.map((role, i) => ({
      phone: `+6019000${String(i + 1).padStart(4, '0')}`,
      fullName: nextName(),
      // Birth date instead of age; age is derived on read. Inlined as a SQL
      // expression (not a parameter) so each row gets its own value.
      birthDate: `(CURRENT_DATE - interval '${15 + Math.floor(Math.random() * 30)} years')::date`,
      gender: Math.random() < 0.5 ? 'male' : 'female',
      role,
      // Spread sign-ups across the backdated window.
      createdAt: `now() - interval '${DAYS + Math.floor(Math.random() * 30)} days'`,
    }));

    // Bulk insert users.
    const userValues = [];
    const userParams = [];
    users.forEach((u, i) => {
      const b = i * 4;
      userValues.push(
        `($${b + 1}, $${b + 2}, ${u.birthDate}, $${b + 3}, $${b + 4}, TRUE, ${u.createdAt})`,
      );
      userParams.push(u.phone, u.fullName, u.gender, u.role);
    });

    await client.query(
      `INSERT INTO users (phone, full_name, birth_date, gender, role, is_dummy, created_at)
       VALUES ${userValues.join(', ')}`,
      userParams,
    );

    // ---- 2. Attendance (backdated) ---------------------------------------
    // Each member gets a random "activity level" so the leaderboard has a
    // realistic spread. Subuh is weighted lower (harder to attend).
    //
    // NOTE: we use a deterministic hash of (user, date, prayer) rather than
    // random() for the per-row decision. PostgreSQL can evaluate random()
    // once for the whole statement, which would concentrate all activity on
    // a handful of members.
    await client.query(`
      CREATE TEMP TABLE sim_activity ON COMMIT DROP AS
      SELECT id,
             (0.25 + random() * 0.65) AS activity
      FROM users WHERE is_dummy = TRUE
    `);

    const attendance = await client.query(
      `INSERT INTO attendance (user_id, prayer, attendance_date, checked_in_at, method, face_score)
       SELECT a.id,
              p.prayer,
              d::date,
              d + (interval '1 hour' * (4 + (abs(hashtext(a.id::text || d::text || p.prayer || 't'))::bigint % 1600) / 100.0)),
              'face',
              0.15 + (abs(hashtext(a.id::text || d::text || p.prayer || 's'))::bigint % 30) / 100.0
       FROM sim_activity a
       CROSS JOIN generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day') d
       CROSS JOIN (VALUES ('subuh'), ('zuhur'), ('asar'), ('maghrib'), ('isyak')) p(prayer)
       WHERE (abs(hashtext(a.id::text || d::text || p.prayer))::bigint % 10000) / 10000.0
             < a.activity * CASE p.prayer WHEN 'subuh' THEN 0.6 ELSE 1 END
       ON CONFLICT (user_id, prayer, attendance_date) DO NOTHING`,
      [DAYS],
    );

    // ---- 3. Quran activity ------------------------------------------------
    const quran = await client.query(
      `INSERT INTO quran_logs (user_id, kind, surah, juz, pages, logged_date, logged_at)
       SELECT a.id,
              CASE WHEN (abs(hashtext(a.id::text || d::text || 'k'))::bigint % 100) < 60
                   THEN 'recitation' ELSE 'memorization' END,
              (ARRAY[${SURAHS.map((s) => `'${s}'`).join(',')}])[
                1 + (abs(hashtext(a.id::text || d::text || 's'))::bigint % ${SURAHS.length})],
              1 + (abs(hashtext(a.id::text || d::text || 'j'))::bigint % 30),
              1 + (abs(hashtext(a.id::text || d::text || 'p'))::bigint % 5),
              d::date,
              d + (interval '1 hour' * (8 + (abs(hashtext(a.id::text || d::text || 'h'))::bigint % 1200) / 100.0))
       FROM sim_activity a
       CROSS JOIN generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day') d
       WHERE (abs(hashtext(a.id::text || d::text || 'q'))::bigint % 10000) / 10000.0
             < a.activity * 0.25`,
      [DAYS],
    );

    // ---- 4. Merits (awarded by the dummy teachers) ------------------------
    // Kept relatively rare so merits complement attendance rather than
    // dominating the overall score.
    const merits = await client.query(
      `INSERT INTO merits (user_id, points, reason, awarded_by, awarded_at)
       SELECT a.id,
              (1 + (abs(hashtext(a.id::text || d::text || 'v'))::bigint % 3)) * 5,
              (ARRAY[${MERIT_REASONS.map((r) => `'${r.replace(/'/g, "''")}'`).join(',')}])[
                1 + (abs(hashtext(a.id::text || d::text || 'r'))::bigint % ${MERIT_REASONS.length})],
              (SELECT id FROM users
               WHERE is_dummy = TRUE AND role = 'teacher'
               ORDER BY hashtext(id::text || a.id::text || d::text) LIMIT 1),
              d + (interval '1 hour' * (9 + (abs(hashtext(a.id::text || d::text || 'm'))::bigint % 1000) / 100.0))
       FROM sim_activity a
       CROSS JOIN generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day') d
       WHERE (abs(hashtext(a.id::text || d::text || 'x'))::bigint % 10000) / 10000.0
             < a.activity * 0.03`,
      [DAYS],
    );

    await client.query('COMMIT');

    console.log('[simulate] seeded:');
    console.log(`  users:      ${users.length} (${TEACHERS} teachers, ${AJK} AJK, ${users.length - TEACHERS - AJK} youths)`);
    console.log(`  attendance: ${attendance.rowCount} rows over ${DAYS} days`);
    console.log(`  quran:      ${quran.rowCount} logs`);
    console.log(`  merits:     ${merits.rowCount} awards`);
    console.log('[simulate] all accounts tagged is_dummy = TRUE.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const clearOnly = process.argv.includes('--clear');
  if (clearOnly) {
    await clearDummy();
  } else {
    await seed();
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[simulate] failed:', err.message);
  process.exit(1);
});
