import {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import { Events } from "discord.js";
import type {
  Client,
  ClientEvents,
  VoiceState,
} from "discord.js";
import { error_message } from "../../shared/helpers/error_message.js";
import * as logger from "../../shared/logger/logger.js";

type ClientEventListener<TEventKey extends keyof ClientEvents> = (...args: ClientEvents[TEventKey]) => void;

export interface VoiceGuardConfig {
  guild_id   : string;
  channel_id : string;
}

interface VoiceGuardState {
  client           : Client;
  guild_id         : string;
  channel_id       : string;
  connection       : VoiceConnection | undefined;
  join_attempt     : Promise<void> | undefined;
  recovery_abort   : AbortController | undefined;
  retry_timer      : NodeJS.Timeout | undefined;
  retry_count      : number;
  stopped          : boolean;
  on_shard_ready   : ClientEventListener<"shardReady">;
  on_shard_resume  : ClientEventListener<"shardResume">;
  on_voice_state   : ClientEventListener<"voiceStateUpdate">;
}

const states = new WeakMap<Client, VoiceGuardState>();
const max_retry_ms = 60_000;
const connect_timeout_ms = 20_000;
const reconnect_timeout_ms = 15_000;

/** BEGIN voice guard */

export async function start(client: Client, config: VoiceGuardConfig): Promise<void> {

  const guild_id = config.guild_id.trim();
  const channel_id = config.channel_id.trim();

  if (!guild_id || !channel_id) {
    throw new Error("VOICE_GUILD_ID and VOICE_CHANNEL_ID must both be set.");
  }

  if (!client.isReady()) {
    throw new Error("The Discord client must be ready before starting the voice guard.");
  }

  const active_state = states.get(client);

  if (active_state) {
    if (active_state.guild_id === guild_id && active_state.channel_id === channel_id) {
      return;
    }

    throw new Error("The voice guard is already running with a different channel.");
  }

  const state: VoiceGuardState = {
    client,
    guild_id,
    channel_id,
    connection: undefined,
    join_attempt: undefined,
    recovery_abort: undefined,
    retry_timer: undefined,
    retry_count: 0,
    stopped: false,
    on_shard_ready: () => {
      handle_gateway_ready(state);
    },
    on_shard_resume: () => {
      handle_gateway_ready(state);
    },
    on_voice_state: (_old_state, new_state) => {
      on_voice_state(state, new_state);
    },
  };

  states.set(client, state);
  client.on(Events.ShardReady, state.on_shard_ready);
  client.on(Events.ShardResume, state.on_shard_resume);
  client.on(Events.VoiceStateUpdate, state.on_voice_state);

  await connect(state, true);

}

export function stop(client: Client): void {

  const state = states.get(client);

  if (!state) {
    return;
  }

  state.stopped = true;

  if (state.retry_timer) {
    clearTimeout(state.retry_timer);
    state.retry_timer = undefined;
  }

  client.off(Events.ShardReady, state.on_shard_ready);
  client.off(Events.ShardResume, state.on_shard_resume);
  client.off(Events.VoiceStateUpdate, state.on_voice_state);

  const connection = state.connection;
  state.connection = undefined;
  state.recovery_abort?.abort();
  state.recovery_abort = undefined;
  connection?.destroy();
  states.delete(client);

}

function on_voice_state(state: VoiceGuardState, new_state: VoiceState): void {

  if (new_state.guild.id !== state.guild_id
    || new_state.id !== state.client.user?.id
    || new_state.channelId === state.channel_id) {
    return;
  }

  const connection = state.connection;

  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    return;
  }

  logger.log("info", "voice_guard_channel_left", {
    guild_id:           state.guild_id,
    channel_id:         state.channel_id,
    current_channel_id: new_state.channelId ?? "none",
  });

  connection.destroy();

}

async function connect(state: VoiceGuardState, throw_on_failure = false): Promise<void> {

  if (state.stopped) {
    return;
  }

  if (!state.client.isReady()) {
    if (throw_on_failure) {
      throw new Error("The Discord client is not ready.");
    }

    return;
  }

  if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return;
  }

  cancel_retry(state);

  const join_attempt = state.join_attempt ?? create_connection(state);
  state.join_attempt = join_attempt;

  try {
    await join_attempt;
  } catch (error) {
    if (throw_on_failure) {
      throw error;
    }
  } finally {
    if (state.join_attempt === join_attempt) {
      state.join_attempt = undefined;
    }
  }

}

async function create_connection(state: VoiceGuardState): Promise<void> {

  try {
    const guild = await state.client.guilds.fetch(state.guild_id);

    if (state.stopped) {
      return;
    }

    const channel = await guild.channels.fetch(state.channel_id);

    if (state.stopped) {
      return;
    }

    if (!channel?.isVoiceBased()) {
      throw new Error("VOICE_CHANNEL_ID must point to a voice or stage channel.");
    }

    const connection = joinVoiceChannel({
      guildId:        guild.id,
      channelId:      channel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf:       false,
      selfMute:       false,
    });

    state.connection = connection;
    watch_connection(state, connection);

    await entersState(connection, VoiceConnectionStatus.Ready, connect_timeout_ms);

    if (state.stopped || state.connection !== connection) {
      return;
    }

    state.retry_count = 0;
    cancel_retry(state);

    logger.log("info", "voice_guard_connected", {
      guild_id:   state.guild_id,
      channel_id: state.channel_id,
    });
  } catch (error) {
    if (state.stopped) {
      return;
    }

    const connection = state.connection;

    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }

    logger.log("error", "voice_guard_connect_failed", {
      guild_id:   state.guild_id,
      channel_id: state.channel_id,
      message:   error_message(error),
    });

    schedule_retry(state, "connect_failed");
    throw error;
  }

}

function watch_connection(state: VoiceGuardState, connection: VoiceConnection): void {

  connection.on("stateChange", (_old_state, new_state) => {
    if (state.connection !== connection) {
      return;
    }

    if (new_state.status === VoiceConnectionStatus.Ready) {
      state.retry_count = 0;
      cancel_retry(state);
      state.recovery_abort?.abort();
      state.recovery_abort = undefined;
      return;
    }

    if (new_state.status === VoiceConnectionStatus.Disconnected) {
      void recover_connection(state, connection);
      return;
    }

    if (new_state.status === VoiceConnectionStatus.Destroyed) {
      state.connection = undefined;

      if (!state.stopped) {
        schedule_retry(state, "connection_destroyed");
      }
    }
  });

  connection.on("error", (error) => {
    logger.log("error", "voice_guard_connection_error", {
      guild_id:   state.guild_id,
      channel_id: state.channel_id,
      message:   error.message,
    });
  });

}

async function recover_connection(state: VoiceGuardState, connection: VoiceConnection): Promise<void> {

  if (state.recovery_abort && !state.recovery_abort.signal.aborted) {
    return;
  }

  const recovery_abort = new AbortController();
  state.recovery_abort = recovery_abort;

  try {
    const connect_signal = AbortSignal.any([
      recovery_abort.signal,
      AbortSignal.timeout(5_000),
    ]);

    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, connect_signal),
      entersState(connection, VoiceConnectionStatus.Connecting, connect_signal),
    ]);

    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      const ready_signal = AbortSignal.any([
        recovery_abort.signal,
        AbortSignal.timeout(reconnect_timeout_ms),
      ]);

      await entersState(connection, VoiceConnectionStatus.Ready, ready_signal);
    }
  } catch {
    if (!state.stopped && state.connection === connection && !recovery_abort.signal.aborted) {
      logger.log("info", "voice_guard_rejoining", {
        guild_id:   state.guild_id,
        channel_id: state.channel_id,
      });

      connection.destroy();
    }
  } finally {
    if (state.recovery_abort === recovery_abort) {
      state.recovery_abort = undefined;
    }
  }

}

function handle_gateway_ready(state: VoiceGuardState): void {

  if (state.stopped) {
    return;
  }

  const connection = state.connection;

  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    void connect(state);
    return;
  }

  if (connection.state.status === VoiceConnectionStatus.Disconnected) {
    void recover_connection(state, connection);
  }

}

function schedule_retry(state: VoiceGuardState, reason: string): void {

  if (state.stopped || state.retry_timer || !state.client.isReady()) {
    return;
  }

  const delay_ms = Math.min(max_retry_ms, 1_000 * (2 ** Math.min(state.retry_count, 6)));
  state.retry_count += 1;
  state.retry_timer = setTimeout(() => {
    state.retry_timer = undefined;
    void connect(state);
  }, delay_ms);
  state.retry_timer.unref();

  logger.log("info", "voice_guard_retry_scheduled", {
    guild_id:   state.guild_id,
    channel_id: state.channel_id,
    delay_ms,
    reason,
  });

}

function cancel_retry(state: VoiceGuardState): void {

  if (!state.retry_timer) {
    return;
  }

  clearTimeout(state.retry_timer);
  state.retry_timer = undefined;

}

/** END voice guard */
