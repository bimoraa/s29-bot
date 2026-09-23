/* eslint @typescript-eslint/naming-convention: ["error", { "selector": "typeLike", "format": ["snake_case"] }, { "selector": "typeParameter", "format": ["snake_case"] }] */
import type { PoolClient } from "pg";
import * as database from "../../infrastructure/database/database.js";
import { error_message } from "../../shared/helpers/error_message.js";
import * as logger from "../../shared/logger/logger.js";

type activity_query_row = Record<string, unknown>;

export interface week_bounds {
  start_day: string;
  end_day: string;
}

export interface afk_transition {
  reason: string | null;
  started_at: Date | string | null;
}

export interface last_seen_result {
  last_seen_at: Date | string | null;
  last_activity: string | null;
  afk_reason: string | null;
  afk_since: Date | string | null;
}

export interface voice_time_result {
  weekly_voice_seconds: string | number;
  total_voice_seconds: string | number;
}

export interface leaderboard_entry {
  user_id: string;
  activity_count: string | number;
}

export interface vc_streak_result {
  current_vc_streak: number;
  best_vc_streak: number;
  qualified_vc_days_total: string | number;
  last_vc_day: string | null;
}

interface voice_session {
  guild_id: string;
  user_id: string;
  channel_id: string;
  last_flushed_at_ms: number;
}

export interface voice_session_input {
  guild_id: string;
  user_id: string;
  channel_id: string;
}

interface voice_day_segment {
  activity_day: string;
  voice_seconds: number;
}

const jakarta_offset_ms = 7 * 60 * 60 * 1_000;
const day_ms = 24 * 60 * 60 * 1_000;
const voice_tick_ms = 60 * 1_000;
const max_voice_flush_seconds = 60;
const minimum_streak_voice_seconds = 10 * 60;
const daily_activity_retention_days = 90;
const voice_sessions = new Map<string, voice_session>();
const user_locks = new Map<string, Promise<void>>();

let flush_timer: NodeJS.Timeout | undefined;
let flush_promise: Promise<void> | undefined;
let last_cleanup_day: string | undefined;
let stopping = false;

/** BEGIN activity persistence */

export async function initialize(): Promise<void> {

  if (flush_timer) {
    return;
  }

  await database.query(`
    CREATE TABLE IF NOT EXISTS activity_profiles (
      guild_id text NOT NULL,
      user_id text NOT NULL,
      last_seen_at timestamptz,
      last_activity text,
      afk_reason text,
      afk_since timestamptz,
      total_voice_seconds bigint NOT NULL DEFAULT 0,
      current_vc_streak integer NOT NULL DEFAULT 0,
      best_vc_streak integer NOT NULL DEFAULT 0,
      qualified_vc_days_total bigint NOT NULL DEFAULT 0,
      last_vc_day date,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS activity_daily (
      guild_id text NOT NULL,
      user_id text NOT NULL,
      activity_day date NOT NULL,
      message_count integer NOT NULL DEFAULT 0,
      voice_seconds bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, activity_day)
    )
  `);
  await database.query(`
    CREATE INDEX IF NOT EXISTS activity_daily_guild_day_index
    ON activity_daily (guild_id, activity_day)
  `);

  stopping = false;
  await cleanup_old_activity_rows();
  last_cleanup_day = get_jakarta_day_key(Date.now());
  flush_timer = setInterval(() => {
    void flush_active_voice_sessions().catch((error: unknown) => {
      logger.log("error", "activity_voice_flush_failed", {
        message: error_message(error),
      });
    });
  }, voice_tick_ms);
  flush_timer.unref();

}

export async function stop(): Promise<void> {

  stopping = true;

  if (flush_timer) {
    clearInterval(flush_timer);
    flush_timer = undefined;
  }

  let first_error: unknown;

  if (flush_promise) {
    try {
      await flush_promise;
    } catch (error) {
      first_error = error;
      logger.log("error", "activity_voice_shutdown_flush_failed", {
        message: error_message(error),
      });
    }
  }

  await Promise.all([...user_locks.values()]);

  for (const [session_key, session] of [...voice_sessions.entries()]) {
    try {
      await with_user_lock(session_key, async () => {
        await flush_voice_session(session, Date.now());
        voice_sessions.delete(session_key);
      });
    } catch (error) {
      first_error ??= error;
      logger.log("error", "activity_voice_shutdown_flush_failed", {
        guild_id: session.guild_id,
        user_id: session.user_id,
        message: error_message(error),
      });
      voice_sessions.delete(session_key);
    }
  }

  if (first_error !== undefined) {
    throw first_error;
  }

}

export async function record_message(
  guild_id: string,
  user_id: string,
): Promise<afk_transition | null> {

  if (stopping) {
    return null;
  }

  return with_user_lock(get_session_key(guild_id, user_id), () => database.with_transaction(async (client) => {
    const previous_result = await client.query<activity_query_row & {
      afk_reason: string | null;
      afk_since: Date | string | null;
    }>(
      `SELECT afk_reason, afk_since
       FROM activity_profiles
       WHERE guild_id = $1 AND user_id = $2
       FOR UPDATE`,
      [guild_id, user_id],
    );
    const previous_profile = previous_result.rows[0];

    await client.query(
      `INSERT INTO activity_profiles (
         guild_id, user_id, last_seen_at, last_activity
       ) VALUES ($1, $2, NOW(), 'chat')
       ON CONFLICT (guild_id, user_id) DO UPDATE
       SET last_seen_at = NOW(),
           last_activity = 'chat',
           afk_reason = NULL,
           afk_since = NULL`,
      [guild_id, user_id],
    );
    await increment_message_count(client, guild_id, user_id, get_jakarta_day_key(Date.now()));

    if (previous_profile?.afk_reason === null || previous_profile === undefined) {
      return null;
    }

    return {
      reason: previous_profile.afk_reason,
      started_at: previous_profile.afk_since,
    };
  }));

}

export async function set_afk(guild_id: string, user_id: string, reason: string | null): Promise<Date> {

  if (stopping) {
    throw new Error("Activity tracking is stopping.");
  }

  return with_user_lock(get_session_key(guild_id, user_id), async () => {
    const result = await database.query<activity_query_row & { afk_since: Date }>(
      `INSERT INTO activity_profiles (
         guild_id, user_id, afk_reason, afk_since
       ) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (guild_id, user_id) DO UPDATE
       SET afk_reason = EXCLUDED.afk_reason,
           afk_since = NOW()
       RETURNING afk_since`,
      [guild_id, user_id, reason],
    );
    const started_at = result.rows[0]?.afk_since;

    if (!started_at) {
      throw new Error("Failed to save AFK status.");
    }

    return started_at;
  });

}

export async function get_last_seen(guild_id: string, user_id: string): Promise<last_seen_result | null> {

  const result = await database.query<activity_query_row & last_seen_result>(
    `SELECT last_seen_at, last_activity, afk_reason, afk_since
     FROM activity_profiles
     WHERE guild_id = $1 AND user_id = $2`,
    [guild_id, user_id],
  );

  return result.rows[0] ?? null;

}

export async function get_voice_time(
  guild_id: string,
  user_id: string,
  period: week_bounds,
): Promise<voice_time_result> {

  const result = await database.query<activity_query_row & voice_time_result>(
    `SELECT
       COALESCE((
         SELECT SUM(voice_seconds)
         FROM activity_daily
         WHERE guild_id = $1 AND user_id = $2
           AND activity_day >= $3::date AND activity_day <= $4::date
       ), 0)::bigint AS weekly_voice_seconds,
       COALESCE(
         (SELECT total_voice_seconds FROM activity_profiles WHERE guild_id = $1 AND user_id = $2),
         0
       )::bigint AS total_voice_seconds`,
    [guild_id, user_id, period.start_day, period.end_day],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to read voice activity.");
  }

  return row;

}

export async function get_most_active(
  guild_id: string,
  period: week_bounds,
): Promise<{ chat: leaderboard_entry[]; voice: leaderboard_entry[] }> {

  const [chat_result, voice_result] = await Promise.all([
    database.query<activity_query_row & leaderboard_entry>(
      `SELECT user_id, SUM(message_count)::bigint AS activity_count
       FROM activity_daily
       WHERE guild_id = $1 AND activity_day >= $2::date AND activity_day <= $3::date
       GROUP BY user_id
       HAVING SUM(message_count) > 0
       ORDER BY SUM(message_count) DESC, user_id ASC
       LIMIT 5`,
      [guild_id, period.start_day, period.end_day],
    ),
    database.query<activity_query_row & leaderboard_entry>(
      `SELECT user_id, SUM(voice_seconds)::bigint AS activity_count
       FROM activity_daily
       WHERE guild_id = $1 AND activity_day >= $2::date AND activity_day <= $3::date
       GROUP BY user_id
       HAVING SUM(voice_seconds) > 0
       ORDER BY SUM(voice_seconds) DESC, user_id ASC
       LIMIT 5`,
      [guild_id, period.start_day, period.end_day],
    ),
  ]);

  return {
    chat: chat_result.rows,
    voice: voice_result.rows,
  };

}

export async function get_vc_streak(guild_id: string, user_id: string): Promise<vc_streak_result> {

  const result = await database.query<activity_query_row & vc_streak_result>(
    `SELECT current_vc_streak, best_vc_streak, qualified_vc_days_total, last_vc_day::text AS last_vc_day
     FROM activity_profiles
     WHERE guild_id = $1 AND user_id = $2`,
    [guild_id, user_id],
  );
  const row = result.rows[0];

  return row ?? {
    current_vc_streak: 0,
    best_vc_streak: 0,
    qualified_vc_days_total: 0,
    last_vc_day: null,
  };

}

export async function record_voice_state(
  guild_id: string,
  user_id: string,
  old_channel_id: string | null,
  new_channel_id: string | null,
): Promise<void> {

  if (stopping || old_channel_id === new_channel_id) {
    return;
  }

  const session_key = get_session_key(guild_id, user_id);

  await with_user_lock(session_key, async () => {
    const active_session = voice_sessions.get(session_key);

    if (active_session) {
      try {
        await flush_voice_session(active_session, Date.now());
      } catch (error) {
        logger.log("error", "activity_voice_transition_flush_failed", {
          guild_id,
          user_id,
          message: error_message(error),
        });
      }
    }

    if (new_channel_id === null) {
      voice_sessions.delete(session_key);
    } else {
      voice_sessions.set(session_key, {
        guild_id,
        user_id,
        channel_id: new_channel_id,
        last_flushed_at_ms: Date.now(),
      });
    }

    await update_voice_presence(guild_id, user_id);
  });

}

export async function sync_voice_sessions(active_sessions: voice_session_input[]): Promise<void> {

  if (stopping) {
    return;
  }

  const active_keys = new Set(active_sessions.map((session) => get_session_key(session.guild_id, session.user_id)));

  for (const session_key of [...voice_sessions.keys()]) {
    if (active_keys.has(session_key)) {
      continue;
    }

    await with_user_lock(session_key, async () => {
      const current_session = voice_sessions.get(session_key);

      if (!current_session) {
        return;
      }

      await flush_voice_session(current_session, Date.now());
      voice_sessions.delete(session_key);
      await update_voice_presence(current_session.guild_id, current_session.user_id);
    });
  }

  for (const session of active_sessions) {
    const session_key = get_session_key(session.guild_id, session.user_id);

    await with_user_lock(session_key, async () => {
      if (voice_sessions.has(session_key)) {
        return;
      }

      voice_sessions.set(session_key, {
        ...session,
        last_flushed_at_ms: Date.now(),
      });
      await update_voice_presence(session.guild_id, session.user_id);
    });
  }

}

export function get_week_bounds(now_ms = Date.now()): week_bounds {

  const today = get_jakarta_day_key(now_ms);
  const midday_utc = Date.parse(`${today}T05:00:00.000Z`);
  const weekday = new Date(midday_utc).getUTCDay();
  const days_since_monday = (weekday + 6) % 7;
  const start_timestamp = Date.parse(`${today}T00:00:00.000Z`) - days_since_monday * day_ms;

  return {
    start_day: new Date(start_timestamp).toISOString().slice(0, 10),
    end_day: new Date(start_timestamp + 6 * day_ms).toISOString().slice(0, 10),
  };

}

export function get_jakarta_day_key(timestamp_ms: number): string {

  return new Date(timestamp_ms + jakarta_offset_ms).toISOString().slice(0, 10);

}

/** END activity persistence */

/** BEGIN voice time accounting */

async function increment_message_count(
  client: PoolClient,
  guild_id: string,
  user_id: string,
  activity_day: string,
): Promise<void> {

  await client.query(
    `INSERT INTO activity_daily (guild_id, user_id, activity_day, message_count)
     VALUES ($1, $2, $3::date, 1)
     ON CONFLICT (guild_id, user_id, activity_day) DO UPDATE
     SET message_count = activity_daily.message_count + 1`,
    [guild_id, user_id, activity_day],
  );

}

async function update_voice_presence(guild_id: string, user_id: string): Promise<void> {

  await database.query(
    `INSERT INTO activity_profiles (guild_id, user_id, last_seen_at, last_activity)
     VALUES ($1, $2, NOW(), 'voice')
     ON CONFLICT (guild_id, user_id) DO UPDATE
     SET last_seen_at = NOW(), last_activity = 'voice'`,
    [guild_id, user_id],
  );

}

async function flush_active_voice_sessions(): Promise<void> {

  if (stopping) {
    return;
  }

  if (flush_promise) {
    await flush_promise;
    return;
  }

  const next_flush = (async () => {
    const now_ms = Date.now();

    for (const [session_key, session] of [...voice_sessions.entries()]) {
      try {
        await with_user_lock(session_key, async () => {
          const current_session = voice_sessions.get(session_key);

          if (current_session) {
            await flush_voice_session(current_session, now_ms);
          }
        });
      } catch (error) {
        logger.log("error", "activity_voice_session_flush_failed", {
          guild_id: session.guild_id,
          user_id: session.user_id,
          message: error_message(error),
        });
      }
    }

    const today = get_jakarta_day_key(now_ms);

    if (last_cleanup_day !== today) {
      await cleanup_old_activity_rows();
      last_cleanup_day = today;
    }
  })();
  flush_promise = next_flush;

  try {
    await next_flush;
  } finally {
    if (flush_promise === next_flush) {
      flush_promise = undefined;
    }
  }

}

async function flush_voice_session(session: voice_session, now_ms: number): Promise<void> {

  const elapsed_seconds = Math.floor((now_ms - session.last_flushed_at_ms) / 1_000);
  const credited_seconds = Math.min(elapsed_seconds, max_voice_flush_seconds);

  if (credited_seconds <= 0) {
    return;
  }

  const start_ms = session.last_flushed_at_ms;
  const segments = split_voice_period(start_ms, credited_seconds);

  await database.with_transaction(async (client) => {
    for (const segment of segments) {
      await record_voice_segment(client, session, segment);
    }
  });

  session.last_flushed_at_ms = now_ms;

}

async function record_voice_segment(
  client: PoolClient,
  session: voice_session,
  segment: voice_day_segment,
): Promise<void> {

  const daily_result = await client.query<activity_query_row & { voice_seconds: string | number }>(
    `INSERT INTO activity_daily (
       guild_id, user_id, activity_day, voice_seconds
     ) VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (guild_id, user_id, activity_day) DO UPDATE
     SET voice_seconds = activity_daily.voice_seconds + EXCLUDED.voice_seconds
     RETURNING voice_seconds`,
    [session.guild_id, session.user_id, segment.activity_day, segment.voice_seconds],
  );
  const daily_voice_seconds = Number(daily_result.rows[0]?.voice_seconds ?? 0);

  await client.query(
    `INSERT INTO activity_profiles AS existing_profile (
       guild_id,
       user_id,
       last_seen_at,
       last_activity,
       total_voice_seconds,
       current_vc_streak,
       best_vc_streak,
       qualified_vc_days_total,
       last_vc_day
     ) VALUES (
       $1,
       $2,
       NOW(),
       'voice',
       $3,
       CASE WHEN $5 >= $6 THEN 1 ELSE 0 END,
       CASE WHEN $5 >= $6 THEN 1 ELSE 0 END,
       CASE WHEN $5 >= $6 THEN 1 ELSE 0 END,
       CASE WHEN $5 >= $6 THEN $4::date ELSE NULL END
     )
     ON CONFLICT (guild_id, user_id) DO UPDATE
     SET last_seen_at = NOW(),
         last_activity = 'voice',
         total_voice_seconds = existing_profile.total_voice_seconds + EXCLUDED.total_voice_seconds,
         current_vc_streak = CASE
           WHEN EXCLUDED.last_vc_day IS NULL OR existing_profile.last_vc_day = EXCLUDED.last_vc_day
             THEN existing_profile.current_vc_streak
           WHEN existing_profile.last_vc_day = EXCLUDED.last_vc_day - 1
             THEN existing_profile.current_vc_streak + 1
           ELSE 1
         END,
         best_vc_streak = GREATEST(
           existing_profile.best_vc_streak,
           CASE
             WHEN EXCLUDED.last_vc_day IS NULL OR existing_profile.last_vc_day = EXCLUDED.last_vc_day
               THEN existing_profile.current_vc_streak
             WHEN existing_profile.last_vc_day = EXCLUDED.last_vc_day - 1
               THEN existing_profile.current_vc_streak + 1
             ELSE 1
           END
         ),
         qualified_vc_days_total = existing_profile.qualified_vc_days_total + CASE
           WHEN EXCLUDED.last_vc_day IS NOT NULL
             AND existing_profile.last_vc_day IS DISTINCT FROM EXCLUDED.last_vc_day
             THEN 1
           ELSE 0
         END,
         last_vc_day = CASE
           WHEN EXCLUDED.last_vc_day IS NOT NULL
             AND existing_profile.last_vc_day IS DISTINCT FROM EXCLUDED.last_vc_day
             THEN EXCLUDED.last_vc_day
           ELSE existing_profile.last_vc_day
         END`,
    [
      session.guild_id,
      session.user_id,
      segment.voice_seconds,
      segment.activity_day,
      daily_voice_seconds,
      minimum_streak_voice_seconds,
    ],
  );

}

async function cleanup_old_activity_rows(): Promise<void> {

  const retention_start = get_jakarta_day_key(Date.now() - daily_activity_retention_days * day_ms);
  await database.query(
    "DELETE FROM activity_daily WHERE activity_day < $1::date",
    [retention_start],
  );

}

function split_voice_period(start_ms: number, duration_seconds: number): voice_day_segment[] {

  const segments: voice_day_segment[] = [];
  let remaining_seconds = duration_seconds;
  let cursor_ms = start_ms;

  while (remaining_seconds > 0) {
    const activity_day = get_jakarta_day_key(cursor_ms);
    const utc_day_start = Date.parse(`${activity_day}T00:00:00.000Z`);
    const next_jakarta_midnight = utc_day_start + day_ms - jakarta_offset_ms;
    const seconds_until_midnight = Math.max(1, Math.floor((next_jakarta_midnight - cursor_ms) / 1_000));
    const voice_seconds = Math.min(remaining_seconds, seconds_until_midnight);

    segments.push({ activity_day, voice_seconds });
    remaining_seconds -= voice_seconds;
    cursor_ms += voice_seconds * 1_000;
  }

  return segments;

}

function get_session_key(guild_id: string, user_id: string): string {

  return `${guild_id}:${user_id}`;

}

async function with_user_lock<t_result>(
  session_key: string,
  action: () => Promise<t_result>,
): Promise<t_result> {

  const previous_lock = user_locks.get(session_key) ?? Promise.resolve();
  const current_action = previous_lock.catch(() => undefined).then(action);
  const current_lock = current_action.then(() => undefined, () => undefined);
  user_locks.set(session_key, current_lock);

  try {
    return await current_action;
  } finally {
    if (user_locks.get(session_key) === current_lock) {
      user_locks.delete(session_key);
    }
  }

}

/** END voice time accounting */
