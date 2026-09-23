import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import test, { after, before } from "node:test";
import { Collection, Events, MessageFlags } from "discord.js";
import * as activity from "../dist/features/activity/__activity.js";
import * as activity_commands from "../dist/features/activity/commands/__activity.js";
import * as activity_events from "../dist/discord/events/__activity.js";
import * as database from "../dist/infrastructure/database/database.js";
import * as http_server from "../dist/infrastructure/http/server.js";
import * as metrics from "../dist/infrastructure/metrics/metrics.js";
import * as queue from "../dist/infrastructure/queue/queue.js";
import * as redis from "../dist/infrastructure/redis/redis.js";
import * as jobs from "../dist/jobs/jobs.js";
import * as health_check from "../dist/jobs/health_check_job.js";
import * as scheduler from "../dist/jobs/scheduler.js";
import { create_interaction, create_user, get_component_text } from "./support.mjs";

const database_config = {
  host: process.env.S29_TEST_DATABASE_HOST,
  port: Number(process.env.S29_TEST_DATABASE_PORT),
  database: "postgres",
  user: process.env.S29_TEST_DATABASE_USER,
  password: "",
};
const redis_url = process.env.S29_TEST_REDIS_URL;
const http_servers = [];

before(async () => {
  await database.connect(database_config);
  await redis.connect(redis_url);
  await activity.initialize();
});

after(async () => {
  for (const server of http_servers) {
    await http_server.close(server);
  }
  await activity.stop();
  await queue.close();
  await redis.close();
  await database.close();
});

test("database transaction commits and rolls back", async () => {

  const guild_id = `transaction-${randomUUID()}`;
  const user_id = "100000000000000010";
  const original_error = new Error("test rollback");

  await database.with_transaction(async (client) => {
    await client.query(
      "INSERT INTO activity_profiles (guild_id, user_id) VALUES ($1, $2)",
      [guild_id, user_id],
    );
  });
  assert.equal((await activity.get_last_seen(guild_id, user_id))?.last_activity, null);

  const rollback_guild = `rollback-${randomUUID()}`;
  await assert.rejects(database.with_transaction(async (client) => {
    await client.query(
      "INSERT INTO activity_profiles (guild_id, user_id) VALUES ($1, $2)",
      [rollback_guild, user_id],
    );
    throw original_error;
  }), (error) => error === original_error);
  assert.equal(await activity.get_last_seen(rollback_guild, user_id), null);
  await database.check();

});

test("activity commands persist AFK, chat, voice time, leaderboard, and streak data", async () => {

  const guild_id = `activity-${randomUUID()}`;
  const user = create_user({ id: "100000000000000011" });
  const afk_interaction = create_interaction("afk", {
    user,
    guild_id,
    strings: { reason: "taking a break *today*" },
  });

  await activity_commands.handle(afk_interaction);
  assert.equal(afk_interaction.replies[0].type, "defer");
  assert.match(get_component_text(afk_interaction.replies.at(-1).payload), /taking a break/);

  const last_seen_interaction = create_interaction("last-seen", {
    user,
    guild_id,
    users: { user },
  });
  await activity_commands.handle(last_seen_interaction);
  assert.match(get_component_text(last_seen_interaction.replies.at(-1).payload), /Belum ada aktivitas/);

  const transition = await activity.record_message(guild_id, user.id);
  assert.equal(transition?.reason, "taking a break *today*");
  assert.ok(transition?.started_at);
  assert.equal(await activity.record_message(guild_id, user.id), null);

  const period = activity.get_week_bounds();
  const leaderboards = await activity.get_most_active(guild_id, period);
  assert.equal(leaderboards.chat.find((entry) => entry.user_id === user.id)?.activity_count, "2");

  const voice_time_interaction = create_interaction("voice-time", { user, guild_id });
  await activity_commands.handle(voice_time_interaction);
  assert.match(get_component_text(voice_time_interaction.replies.at(-1).payload), /Minggu ini/);

  const most_active_interaction = create_interaction("most-active", { user, guild_id });
  await activity_commands.handle(most_active_interaction);
  assert.match(get_component_text(most_active_interaction.replies.at(-1).payload), /Paling aktif minggu ini/);
  assert.match(get_component_text(most_active_interaction.replies.at(-1).payload), new RegExp(user.id));

  const vc_streak_interaction = create_interaction("vc-streak", { user, guild_id });
  await activity_commands.handle(vc_streak_interaction);
  assert.match(get_component_text(vc_streak_interaction.replies.at(-1).payload), /Streak sekarang/);

  const profile = await activity.get_last_seen(guild_id, user.id);
  assert.equal(profile?.last_activity, "chat");
  assert.equal(profile?.afk_reason, null);

});

test("voice sessions split Jakarta midnight and qualify consecutive daily streaks", async () => {

  const original_now = Date.now;
  let clock_ms = Date.parse("2026-09-21T16:59:40.000Z");
  const guild_id = `voice-${randomUUID()}`;
  const rollover_user_id = "100000000000000012";

  try {
    Date.now = () => clock_ms;
    await activity.record_voice_state(guild_id, rollover_user_id, null, "voice-a");
    clock_ms += 60_000;
    await activity.record_voice_state(guild_id, rollover_user_id, "voice-a", null);

    const rollover = await database.query(
      `SELECT activity_day::text, voice_seconds::text
       FROM activity_daily WHERE guild_id = $1 AND user_id = $2 ORDER BY activity_day`,
      [guild_id, rollover_user_id],
    );
    assert.deepEqual(rollover.rows, [
      { activity_day: "2026-09-21", voice_seconds: "20" },
      { activity_day: "2026-09-22", voice_seconds: "40" },
    ]);

    const streak_user_id = "100000000000000013";
    for (const day_start of ["2026-09-21T17:00:00.000Z", "2026-09-22T17:00:00.000Z"]) {
      clock_ms = Date.parse(day_start);
      await activity.record_voice_state(guild_id, streak_user_id, null, "voice-a");
      let channel_id = "voice-a";

      for (let minute = 0; minute < 10; minute += 1) {
        clock_ms += 60_000;
        const next_channel_id = channel_id === "voice-a" ? "voice-b" : "voice-a";
        await activity.record_voice_state(guild_id, streak_user_id, channel_id, next_channel_id);
        channel_id = next_channel_id;
      }

      await activity.record_voice_state(guild_id, streak_user_id, channel_id, null);
    }

    const streak = await activity.get_vc_streak(guild_id, streak_user_id);
    assert.equal(streak.current_vc_streak, 2);
    assert.equal(streak.best_vc_streak, 2);
    assert.equal(streak.qualified_vc_days_total, "2");

    const streak_user = create_user({ id: streak_user_id });
    const streak_interaction = create_interaction("vc-streak", {
      user: streak_user,
      guild_id,
    });
    await activity_commands.handle(streak_interaction);
    assert.match(get_component_text(streak_interaction.replies.at(-1).payload), /Streak sekarang:\*\* 2 hari/);

    const period = activity.get_week_bounds(clock_ms);
    const voice_time = await activity.get_voice_time(guild_id, streak_user_id, period);
    assert.equal(voice_time.weekly_voice_seconds, "1200");
    assert.equal(voice_time.total_voice_seconds, "1200");

    const voice_time_interaction = create_interaction("voice-time", {
      user: streak_user,
      guild_id,
    });
    await activity_commands.handle(voice_time_interaction);
    assert.match(get_component_text(voice_time_interaction.replies.at(-1).payload), /20 menit/);
  } finally {
    Date.now = original_now;
  }

});

test("message and voice gateway listeners filter bots and handle AFK returns", async () => {

  const client = new EventEmitter();
  const own_bot_id = "100000000000000020";
  const guild_id = `events-${randomUUID()}`;
  const author = create_user({ id: "100000000000000021" });
  const bot_user = create_user({ id: "100000000000000022", bot: true });
  const sent_messages = [];
  client.user = { id: own_bot_id };
  client.users = { cache: new Collection([[bot_user.id, bot_user]]) };
  client.guilds = { cache: new Collection() };
  activity_events.register(client);

  await activity.set_afk(guild_id, author.id, "lunch *break*");
  const message = {
    guildId: guild_id,
    author,
    member: { displayName: "A test member", displayAvatarURL: author.displayAvatarURL },
    webhookId: null,
    inGuild: () => true,
    channel: {
      isTextBased: () => true,
      send: async (payload) => sent_messages.push(payload),
    },
  };
  client.emit(Events.MessageCreate, message);
  await wait_until(async () => sent_messages.length === 1);
  assert.equal(sent_messages[0].flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(sent_messages[0].allowedMentions, { parse: [] });
  assert.match(get_component_text(sent_messages[0]), /Welcome back/);
  assert.match(get_component_text(sent_messages[0]), /lunch/);

  const webhook_user = create_user({ id: "100000000000000023" });
  client.emit(Events.MessageCreate, { ...message, author: webhook_user, webhookId: "webhook" });
  assert.equal(await activity.get_last_seen(guild_id, webhook_user.id), null);

  const voice_user = create_user({ id: "100000000000000024" });
  const voice_state = {
    guild: { id: guild_id, members: { cache: new Collection() } },
    id: voice_user.id,
    channelId: "voice-channel",
    member: { user: voice_user },
  };
  client.emit(Events.VoiceStateUpdate, { ...voice_state, channelId: null }, voice_state);
  await wait_until(async () => (await activity.get_last_seen(guild_id, voice_user.id))?.last_activity === "voice");

  const ignored_bot = {
    ...voice_state,
    id: bot_user.id,
    member: { user: bot_user },
  };
  client.emit(Events.VoiceStateUpdate, { ...ignored_bot, channelId: null }, ignored_bot);
  assert.equal(await activity.get_last_seen(guild_id, bot_user.id), null);

  const own_voice_state = { ...voice_state, id: own_bot_id, member: undefined };
  client.emit(Events.VoiceStateUpdate, { ...own_voice_state, channelId: null }, own_voice_state);
  assert.equal(await activity.get_last_seen(guild_id, own_bot_id), null);

});

test("ready and resume listeners synchronize active human voice sessions", async () => {

  const client = new EventEmitter();
  const own_bot_id = "100000000000000030";
  const guild_id = `sync-${randomUUID()}`;
  const human_id = "100000000000000031";
  const bot_id = "100000000000000032";
  const human_state = {
    id: human_id,
    channelId: "voice-channel",
    member: { user: create_user({ id: human_id }) },
  };
  const bot_state = {
    id: bot_id,
    channelId: "voice-channel",
    member: { user: create_user({ id: bot_id, bot: true }) },
  };
  const self_state = { id: own_bot_id, channelId: "voice-channel" };
  const guild = {
    id: guild_id,
    voiceStates: { cache: new Collection([[human_id, human_state], [bot_id, bot_state], [own_bot_id, self_state]]) },
    members: { cache: new Collection() },
  };
  client.user = { id: own_bot_id };
  client.guilds = { cache: new Collection([[guild_id, guild]]) };
  activity_events.register(client);

  client.emit(Events.ClientReady, client);
  await wait_until(async () => (await activity.get_last_seen(guild_id, human_id))?.last_activity === "voice");
  assert.equal(await activity.get_last_seen(guild_id, bot_id), null);
  assert.equal(await activity.get_last_seen(guild_id, own_bot_id), null);

  const resumed_user_id = "100000000000000033";
  guild.voiceStates.cache.set(resumed_user_id, {
    id: resumed_user_id,
    channelId: "voice-channel",
    member: { user: create_user({ id: resumed_user_id }) },
  });
  client.emit(Events.ShardResume);
  await wait_until(async () => (await activity.get_last_seen(guild_id, resumed_user_id))?.last_activity === "voice");

});

test("Redis, BullMQ jobs, scheduled health check, and HTTP probes work together", async () => {

  await redis.check();
  await health_check.run_infrastructure_health_check();
  await jobs.process_job({ name: "infrastructure.health_check" });
  await assert.rejects(jobs.process_job({ name: "missing.test.job" }), /No handler is registered/);

  let processed_resolve;
  const processed = new Promise((resolve) => {
    processed_resolve = resolve;
  });
  await queue.start(redis_url, async (job) => {
    processed_resolve({ name: job.name, data: job.data });
  });
  await queue.add("test.echo", { value: "from-test" });
  assert.deepEqual(await with_timeout(processed), {
    name: "test.echo",
    data: { value: "from-test" },
  });
  await scheduler.start_scheduler();
  await queue.check();

  metrics.record_job_completed("test.echo", 0.01);
  metrics.record_job_failed("test.failure", 0.02);
  let is_ready = true;
  const server = http_server.create(() => is_ready);
  http_servers.push(server);
  await http_server.listen(server, "127.0.0.1", 0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base_url = `http://127.0.0.1:${address.port}`;

  const live = await fetch(`${base_url}/livez`);
  assert.equal(live.status, 200);
  assert.equal(await live.text(), "ok\n");

  const ready = await fetch(`${base_url}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal(await ready.text(), "ready\n");

  is_ready = false;
  const not_ready = await fetch(`${base_url}/readyz`);
  assert.equal(not_ready.status, 503);
  assert.equal(await not_ready.text(), "not ready\n");
  is_ready = true;

  const method_not_allowed = await fetch(`${base_url}/livez`, { method: "POST" });
  assert.equal(method_not_allowed.status, 405);
  const not_found = await fetch(`${base_url}/missing`);
  assert.equal(not_found.status, 404);

  const metrics_response = await fetch(`${base_url}/metrics`);
  assert.equal(metrics_response.status, 200);
  const metrics_body = await metrics_response.text();
  assert.match(metrics_body, /s29_http_requests_total/);
  assert.match(metrics_body, /s29_jobs_completed_total/);
  assert.match(metrics_body, /s29_jobs_failed_total/);

});

async function wait_until(predicate, timeout_ms = 2_000) {

  const deadline = Date.now() + timeout_ms;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail(`Condition did not become true in ${timeout_ms} ms`);

}

async function with_timeout(promise, timeout_ms = 5_000) {

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after ${timeout_ms} ms`)), timeout_ms);
      timer.unref();
    }),
  ]);

}
