import { Events, MessageFlags, escapeMarkdown, type Client, type Message } from "discord.js";
import * as activity from "../../features/activity/__activity.js";
import * as panel from "../commands/panel.js";
import { error_message } from "../../shared/helpers/error_message.js";
import * as logger from "../../shared/logger/logger.js";

export function register(client: Client): void {

  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.bot || message.webhookId) {
      return;
    }

    void record_guild_message(message).catch((error: unknown) => {
      logger.log("error", "activity_message_record_failed", {
        guild_id: message.guildId,
        user_id: message.author.id,
        message: error_message(error),
      });
    });
  });

  client.on(Events.VoiceStateUpdate, (old_state, new_state) => {
    const member = new_state.member
      ?? old_state.member
      ?? new_state.guild.members.cache.get(new_state.id);
    const user = member?.user ?? client.users.cache.get(new_state.id);

    if (user?.bot || new_state.id === client.user?.id) {
      return;
    }

    void activity.record_voice_state(
      new_state.guild.id,
      new_state.id,
      old_state.channelId,
      new_state.channelId,
    ).catch((error: unknown) => {
      logger.log("error", "activity_voice_state_record_failed", {
        guild_id: new_state.guild.id,
        user_id: new_state.id,
        message: error_message(error),
      });
    });
  });

  client.on(Events.ClientReady, (ready_client) => {
    void sync_voice_sessions(ready_client).catch((error: unknown) => {
      logger.log("error", "activity_voice_session_sync_failed", {
        message: error_message(error),
      });
    });
  });

  client.on(Events.ShardResume, () => {
    void sync_voice_sessions(client).catch((error: unknown) => {
      logger.log("error", "activity_voice_session_sync_failed", {
        message: error_message(error),
      });
    });
  });

}

async function record_guild_message(message: Message<true>): Promise<void> {

  const transition = await activity.record_message(message.guildId, message.author.id);

  if (!transition || !message.channel.isTextBased()) {
    return;
  }

  const member_display_name = message.member?.displayName ?? message.author.displayName;
  const reason_display = transition.reason?.trim()
    ? escapeMarkdown(transition.reason)
    : "Nggak ada alasan";
  const afk_duration = format_afk_duration(transition.started_at);
  const user_avatar_url = message.member?.displayAvatarURL({ size: 256 })
    ?? message.author.displayAvatarURL({ size: 256 });
  const user_display_name = escapeMarkdown(member_display_name);
  const fallback_title = `Welcome backk, ${user_display_name}`;
  const fallback_body = `<@${message.author.id}> udah balik dari AFK **${afk_duration}** yaa\n**Tadi AFK karna:** ${reason_display}`;

  await message.channel.send({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: await panel.create_template_components(
      "afk_welcome_back.json",
      {
        user_display_name: user_display_name,
        user_mention: `<@${message.author.id}>`,
        afk_duration,
        reason_display,
        user_avatar_url,
      },
      {
        fallback_title,
        fallback_body,
        avatar_url: user_avatar_url,
        avatar_description: `Avatar ${member_display_name}`,
      },
    ),
  });

}

async function sync_voice_sessions(client: Client): Promise<void> {

  const active_sessions = [];

  for (const guild of client.guilds.cache.values()) {
    for (const voice_state of guild.voiceStates.cache.values()) {
      const member = voice_state.member ?? guild.members.cache.get(voice_state.id);

      if (!voice_state.channelId || member?.user.bot || voice_state.id === client.user?.id) {
        continue;
      }

      active_sessions.push({
        guild_id: guild.id,
        user_id: voice_state.id,
        channel_id: voice_state.channelId,
      });
    }
  }

  await activity.sync_voice_sessions(active_sessions);

}

function format_afk_duration(started_at: Date | string | null): string {

  if (!started_at) {
    return "sebentar";
  }

  const elapsed_seconds = Math.max(0, Math.floor((Date.now() - new Date(started_at).getTime()) / 1_000));
  const total_minutes = Math.floor(elapsed_seconds / 60);
  const hours = Math.floor(total_minutes / 60);
  const minutes = total_minutes % 60;

  if (hours > 0) {
    return `${hours} jam ${minutes} menit`;
  }

  return `${total_minutes} menit`;

}
