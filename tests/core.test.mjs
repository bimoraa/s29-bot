import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Events, MessageFlags } from "discord.js";
import { load_config } from "../dist/config/env.js";
import * as discord_events from "../dist/discord/register.js";
import * as interaction_event from "../dist/discord/events/__interaction_create.js";
import * as calculator from "../dist/features/utility/__calculator.js";
import * as utility_commands from "../dist/discord/commands/__utility.js";
import * as activity_commands from "../dist/features/activity/commands/__activity.js";
import * as voice_guard from "../dist/features/voice/__voice_guard.js";
import { create_interaction, create_user, get_component_text } from "./support.mjs";

const test_env = {
  BOT_TOKEN: "test-token",
  VOICE_GUILD_ID: "1099045452973883486",
  VOICE_CHANNEL_ID: "1099045452973883487",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "55432",
  DATABASE_NAME: "test_db",
  DATABASE_USER: "test_user",
  DATABASE_PASSWORD: "test-password",
  REDIS_URL: "redis://127.0.0.1:56379/15",
};

test("config loader applies defaults and rejects malformed values", async (t) => {

  await t.test("valid values and defaults", () => {
    const config = load_config(test_env);
    assert.equal(config.database.port, 55_432);
    assert.equal(config.http_port, 3_000);
    assert.equal(config.http_host, "0.0.0.0");
    assert.equal(config.redis_url, test_env.REDIS_URL);
  });

  await t.test("required token", () => {
    assert.throws(() => load_config({ ...test_env, BOT_TOKEN: "  " }), /BOT_TOKEN is required/);
  });

  await t.test("Discord IDs", () => {
    assert.throws(() => load_config({ ...test_env, VOICE_GUILD_ID: "not-an-id" }), /VOICE_GUILD_ID/);
    assert.throws(() => load_config({ ...test_env, VOICE_CHANNEL_ID: "12" }), /VOICE_CHANNEL_ID/);
  });

  await t.test("ports and Redis URL", () => {
    assert.throws(() => load_config({ ...test_env, HTTP_PORT: "65536" }), /HTTP_PORT/);
    assert.throws(() => load_config({ ...test_env, DATABASE_PORT: "4.5" }), /DATABASE_PORT/);
    assert.throws(() => load_config({ ...test_env, REDIS_URL: "https://example.test" }), /REDIS_URL/);
  });

});

test("calculator handles operators, precedence, and invalid input", async (t) => {

  const cases = [
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["2 ^ 3 ^ 2", 512],
    ["-2^2", -4],
    ["7 % 4", 3],
    ["1.5e2 / 3", 50],
    ["--5", 5],
  ];

  for (const [expression, expected] of cases) {
    await t.test(expression, () => {
      assert.equal(calculator.evaluate_expression(expression), expected);
    });
  }

  const invalid_cases = [
    ["", /Enter an expression/],
    ["2 / 0", /Division by zero/],
    ["(2 + 3", /closing parenthesis/],
    ["2 + nope", /Use only numbers/],
    ["2 ^ 1024", /result is too large/],
    ["1".repeat(201), /too long/],
  ];

  for (const [expression, expected] of invalid_cases) {
    await t.test(`rejects ${expression.slice(0, 24)}`, () => {
      assert.throws(() => calculator.evaluate_expression(expression), expected);
    });
  }

});

test("all registered utility and activity commands are routed", () => {

  assert.deepEqual(
    utility_commands.utility_commands.map((command) => command.name).sort(),
    ["avatar", "banner", "calc", "ping", "serverinfo", "timestamp", "userinfo"],
  );
  assert.deepEqual(
    activity_commands.commands.map((command) => command.name).sort(),
    ["afk", "last-seen", "most-active", "vc-streak", "voice-time"],
  );
  assert.equal(activity_commands.handles("afk"), true);
  assert.equal(activity_commands.handles("not-a-command"), false);
});

test("Discord event registration and interaction routing stay local and single-owner", async () => {

  const client = new EventEmitter();
  discord_events.register(client);
  assert.equal(client.listenerCount(Events.MessageCreate), 1);
  assert.equal(client.listenerCount(Events.InteractionCreate), 1);
  assert.equal(client.listenerCount(Events.VoiceStateUpdate), 1);

  const interaction_client = new EventEmitter();
  interaction_event.register(interaction_client);
  const interaction = create_interaction("ping");
  interaction.isChatInputCommand = () => true;
  interaction_client.emit(Events.InteractionCreate, interaction);
  await wait_until(() => interaction.replies.some((reply) => reply.type === "edit"));
  assert.equal(interaction.replies[0]?.type, "defer");
  assert.match(get_component_text(interaction.replies.at(-1).payload), /Gateway/);

  const non_command = { isChatInputCommand: () => false };
  interaction_client.emit(Events.InteractionCreate, non_command);
  assert.equal(interaction.replies.length, 2);

});

test("utility command router renders each feature through Components V2", async (t) => {

  const cases = [
    ["avatar", {}, /Avatar/],
    ["banner", {}, /Banner nggak ketemuu/],
    ["userinfo", {}, /Username/],
    ["serverinfo", {}, /Info server/],
    ["ping", {}, /Gateway/],
    ["timestamp", { strings: { date: "1700000000" } }, /Discord timestamp/],
    ["calc", { strings: { expression: "2 + 2" } }, /4/],
  ];

  for (const [command_name, options, expected_text] of cases) {
    await t.test(`/${command_name}`, async () => {
      const interaction = create_interaction(command_name, options);
      await utility_commands.handle(interaction);
      assert.equal(interaction.replies[0]?.type, "defer");
      const response = interaction.replies.at(-1)?.payload;
      assert.equal(interaction.replies.at(-1)?.type, "edit");
      assert.equal(response.flags, MessageFlags.IsComponentsV2);
      assert.deepEqual(response.allowedMentions, { parse: [] });
      assert.match(get_component_text(response), expected_text);
    });
  }

  await t.test("banner with an image", async () => {
    const target_user = create_user({ bannerURL: () => "https://cdn.example.test/banner.png" });
    const interaction = create_interaction("banner", { users: { user: target_user } });
    await utility_commands.handle(interaction);
    assert.match(get_component_text(interaction.replies.at(-1).payload), /User ID/);
  });

  await t.test("invalid calculator and timestamp inputs stay user-facing", async () => {
    const bad_calc = create_interaction("calc", { strings: { expression: "1 / 0" } });
    await utility_commands.handle(bad_calc);
    assert.match(get_component_text(bad_calc.replies.at(-1).payload), /Division by zero/);

    const bad_timestamp = create_interaction("timestamp", { strings: { date: "not-a-date" } });
    await utility_commands.handle(bad_timestamp);
    assert.match(get_component_text(bad_timestamp.replies.at(-1).payload), /Tanggal nggak valid/);
  });

  await t.test("uncached guild is handled without running a command", async () => {
    const interaction = create_interaction("ping", { cached_guild: false });
    await utility_commands.handle(interaction);
    assert.match(get_component_text(interaction.replies.at(-1).payload), /Server unavailable/);
  });

});

test("voice guard rejects invalid start conditions without connecting", async (t) => {

  const client = {
    isReady: () => false,
    on: () => assert.fail("listeners must not be installed before readiness"),
  };

  await t.test("requires both IDs", async () => {
    await assert.rejects(
      voice_guard.start(client, { guild_id: "", channel_id: "channel" }),
      /must both be set/,
    );
  });

  await t.test("requires a ready Discord client", async () => {
    await assert.rejects(
      voice_guard.start(client, { guild_id: "guild", channel_id: "channel" }),
      /client must be ready/,
    );
  });

  assert.equal(Events.ShardReady, "shardReady");
  voice_guard.stop(client);

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
