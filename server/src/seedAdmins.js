/**
 * Seed admin accounts from ADMIN_PHONES.
 *
 * On a fresh deploy nobody can reach the admin panel until an admin has logged
 * in once, because roles are only assigned lazily in the OTP verify step. That
 * is a chicken-and-egg problem: the admin needs the panel to fix things (e.g.
 * the Telegram bot token), but the panel needs an admin.
 *
 * This script runs on every API start (see Dockerfile CMD) and makes sure each
 * phone in ADMIN_PHONES exists as an active admin. It is idempotent:
 *
 *   - missing phone  -> create an active admin ("New Member", prompts profile)
 *   - existing user  -> promote to admin (never demote, never touch other fields)
 *
 * It deliberately does NOT overwrite full_name, so a real name set during
 * registration is preserved. Run manually with:
 *   docker compose exec -T api node src/seedAdmins.js
 */

import { pool } from './db.js';
import { config } from './config.js';

async function seedAdmins() {
  const phones = config.adminPhones;

  if (phones.length === 0) {
    console.log('[seed-admins] ADMIN_PHONES is empty - nothing to do.');
    return;
  }

  let created = 0;
  let promoted = 0;

  for (const phone of phones) {
    // ON CONFLICT keeps this safe to run on every boot and preserves any
    // profile data the user has already filled in.
    const { rows } = await pool.query(
      `INSERT INTO users (phone, full_name, role, is_active)
       VALUES ($1, 'New Member', 'admin', TRUE)
       ON CONFLICT (phone) DO UPDATE
         SET role = 'admin', updated_at = now()
         WHERE users.role <> 'admin'
       RETURNING (xmax = 0) AS inserted`,
      [phone],
    );

    if (rows[0]?.inserted) {
      created += 1;
      console.log(`[seed-admins] created admin ${phone}`);
    } else if (rows[0]) {
      promoted += 1;
      console.log(`[seed-admins] promoted ${phone} to admin`);
    }
  }

  console.log(
    `[seed-admins] done (${created} created, ${promoted} promoted, ${phones.length} configured).`,
  );
}

seedAdmins()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[seed-admins] failed', err);
    process.exit(1);
  });
