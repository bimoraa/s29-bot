/* eslint @typescript-eslint/naming-convention: ["error", { "selector": "typeLike", "format": ["snake_case"] }, { "selector": "typeParameter", "format": ["snake_case"] }] */
import { randomUUID } from "node:crypto";
import {
  MessageFlags,
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";
import * as activity from "../__activity.js";
import * as panel from "../../../discord/commands/panel.js";
import { error_message } from "../../../shared/helpers/error_message.js";
import * as logger from "../../../shared/logger/logger.js";

type activity_command_handler = (interaction: ChatInputCommandInteraction<"cached">) => Promise<void>;

interface leaderboard_display_entry {
  user_id: string;
  activity_count: number;
  avatar_url: string;
}

export const afk_command = new SlashCommandBuilder()
  .setName("afk")
  .setDescription("Tandai kalau kamu lagi AFK.")
  .addStringOption((option) => option
    .setName("reason")
    .setDescription("Alasan AFK, kalau mau.")
    .setMaxLength(200)
    .setRequired(false));

export const last_seen_command = new SlashCommandBuilder()
  .setName("last-seen")
  .setDescription("Lihat kapan terakhir user aktif.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang mau dicek.")
    .setRequired(false));

export const voice_time_command = new SlashCommandBuilder()
  .setName("voice-time")
  .setDescription("Lihat waktu nongkrong user di voice channel.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang mau dicek.")
    .setRequired(false));

export const most_active_command = new SlashCommandBuilder()
  .setName("most-active")
  .setDescription("Lihat member paling aktif minggu ini.");

export const vc_streak_command = new SlashCommandBuilder()
  .setName("vc-streak")
  .setDescription("Lihat streak nongkrong di voice channel.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang mau dicek.")
    .setRequired(false));

const command_handlers: ReadonlyMap<string, activity_command_handler> = new Map([
  [afk_command.name, handle_afk],
  [last_seen_command.name, handle_last_seen],
  [voice_time_command.name, handle_voice_time],
  [most_active_command.name, handle_most_active],
  [vc_streak_command.name, handle_vc_streak],
]);

const public_commands = new Set([afk_command.name, most_active_command.name]);

export const commands = [
  afk_command,
  last_seen_command,
  voice_time_command,
  most_active_command,
  vc_streak_command,
];

export function handles(command_name: string): boolean {

  return command_handlers.has(command_name);

}

export async function handle(interaction: ChatInputCommandInteraction): Promise<void> {

  if (public_commands.has(interaction.commandName)) {
    await interaction.deferReply();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  try {
    if (!interaction.inCachedGuild()) {
      await panel.send_template(
        interaction,
        "command_error.json",
        {
          error_title: "Fitur aktivitas cuma bisa dipakai di server",
          error_message: "Pakai command ini di server tempat bot terpasang yaa",
        },
        {
          fallback_title: "Fitur aktivitas cuma bisa dipakai di server",
          fallback_body: "Pakai command ini di server tempat bot terpasang yaa",
          avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
        },
      );
      return;
    }

    const command_handler = command_handlers.get(interaction.commandName);

    if (!command_handler) {
      await panel.send_template(
        interaction,
        "command_error.json",
        {
          error_title: "Command aktivitas nggak ketemuu",
          error_message: "Coba panggil lagi yaa",
        },
        {
          fallback_title: "Command aktivitas nggak ketemuu",
          fallback_body: "Coba panggil lagi yaa",
          avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
        },
      );
      return;
    }

    await command_handler(interaction);
  } catch (error) {
    const error_code = randomUUID();

    logger.log("error", "activity_command_failed", {
      command: interaction.commandName,
      error_code,
      message: error_message(error),
    });

    await panel.send_template(
      interaction,
      "activity_error.json",
      { activity_error_message: "Ada masalah waktu baca data," },
      {
        fallback_title: "Data aktivitas belum bisa diambil",
        fallback_body: "Coba lagi bentar yaa",
        avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
      },
    );
  }

}

async function handle_afk(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const reason = interaction.options.getString("reason")?.trim() || null;
  const started_at = await activity.set_afk(interaction.guildId, interaction.user.id, reason);
  const reason_display = reason ? escapeMarkdown(reason) : "Nggak ada alasan";
  const started_at_display = `<t:${Math.floor(started_at.getTime() / 1_000)}:F>`;

  await panel.send_template(
    interaction,
    "afk_set.json",
    {
      user_mention: `<@${interaction.user.id}>`,
      reason_display,
      afk_started_at: started_at_display,
      user_avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: `<@${interaction.user.id}> lagi AFK yaa`,
      fallback_body: `**Alasan:** ${reason_display}\n**Sejak:** ${started_at_display}`,
      avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
      avatar_description: `Avatar ${interaction.user.displayName}`,
    },
  );

}

async function handle_last_seen(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const target_user = interaction.options.getUser("user") ?? interaction.user;
  const profile = await activity.get_last_seen(interaction.guildId, target_user.id);
  const last_seen_display = profile?.last_seen_at
    ? `<t:${Math.floor(new Date(profile.last_seen_at).getTime() / 1_000)}:F> · <t:${Math.floor(new Date(profile.last_seen_at).getTime() / 1_000)}:R>`
    : "Belum ada aktivitas yang tercatat";
  const last_seen_source = profile?.last_activity === "chat"
    ? "Chat"
    : profile?.last_activity === "voice"
      ? "Voice channel"
      : "Belum ada aktivitas";

  await panel.send_template(
    interaction,
    "last_seen.json",
    {
      target_display_name: escapeMarkdown(target_user.displayName),
      last_seen_display,
      last_seen_source,
      target_avatar_url: target_user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: `Terakhir aktif — ${escapeMarkdown(target_user.displayName)}`,
      fallback_body: `**Terakhir keliatan:** ${last_seen_display}\n**Aktivitas terakhir:** ${last_seen_source}`,
      avatar_url: target_user.displayAvatarURL({ size: 256 }),
      avatar_description: `Avatar ${target_user.displayName}`,
    },
  );

}

async function handle_voice_time(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const target_user = interaction.options.getUser("user") ?? interaction.user;
  const period = activity.get_week_bounds();
  const voice_time = await activity.get_voice_time(interaction.guildId, target_user.id, period);

  await panel.send_template(
    interaction,
    "voice_time.json",
    {
      target_display_name: escapeMarkdown(target_user.displayName),
      weekly_voice_time: format_duration(voice_time.weekly_voice_seconds),
      all_time_voice_time: format_duration(voice_time.total_voice_seconds),
      week_start_date: format_date(period.start_day),
      week_end_date: format_date(period.end_day),
      target_avatar_url: target_user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: `Voice timee — ${escapeMarkdown(target_user.displayName)}`,
      fallback_body: [
        `**Minggu ini:** ${format_duration(voice_time.weekly_voice_seconds)}`,
        `**Totalnya:** ${format_duration(voice_time.total_voice_seconds)}`,
        `**Periode:** ${format_date(period.start_day)} – ${format_date(period.end_day)}`,
      ].join("\n"),
      avatar_url: target_user.displayAvatarURL({ size: 256 }),
      avatar_description: `Avatar ${target_user.displayName}`,
    },
  );

}

async function handle_most_active(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const period = activity.get_week_bounds();
  const leaderboard = await activity.get_most_active(interaction.guildId, period);

  if (leaderboard.chat.length === 0 && leaderboard.voice.length === 0) {
    const avatar_url = interaction.guild.iconURL({ size: 256 })
      ?? interaction.user.displayAvatarURL({ size: 256 });

    await panel.send_template(
      interaction,
      "most_active_empty.json",
      {
        week_start_date: format_date(period.start_day),
        week_end_date: format_date(period.end_day),
        servericon: avatar_url,
      },
      {
        fallback_title: "Belum ada aktivitas minggu ini",
        fallback_body: `Belum ada data chat atau voice time buat periode **${format_date(period.start_day)} – ${format_date(period.end_day)}**`,
        avatar_url,
        avatar_description: `Icon ${interaction.guild.name}`,
      },
    );
    return;
  }

  const [chat_entries, voice_entries] = await Promise.all([
    load_leaderboard_avatars(interaction, leaderboard.chat),
    load_leaderboard_avatars(interaction, leaderboard.voice),
  ]);
  const values: Record<string, string> = {
    week_start_date: format_date(period.start_day),
    week_end_date: format_date(period.end_day),
    servericon: interaction.guild.iconURL({ size: 256 })
      ?? interaction.user.displayAvatarURL({ size: 256 }),
  };

  add_leaderboard_values(values, "chat", chat_entries, "pesan");
  add_leaderboard_values(values, "voice", voice_entries, "voice time");

  const avatar_url = values.servericon ?? interaction.user.displayAvatarURL({ size: 256 });

  await panel.send_template(
    interaction,
    "most_active.json",
    values,
    {
      fallback_title: "Paling aktif minggu ini",
      fallback_body: `Member yang paling aktif minggu ini · ${format_date(period.start_day)} – ${format_date(period.end_day)}`,
      avatar_url,
      avatar_description: `Icon ${interaction.guild.name}`,
    },
  );

}

async function handle_vc_streak(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const target_user = interaction.options.getUser("user") ?? interaction.user;
  const streak = await activity.get_vc_streak(interaction.guildId, target_user.id);
  const today = activity.get_jakarta_day_key(Date.now());
  const yesterday = activity.get_jakarta_day_key(Date.now() - 24 * 60 * 60 * 1_000);
  const current_streak = streak.last_vc_day === today || streak.last_vc_day === yesterday
    ? streak.current_vc_streak
    : 0;

  await panel.send_template(
    interaction,
    "vc_streak.json",
    {
      target_display_name: escapeMarkdown(target_user.displayName),
      current_streak_days: String(current_streak),
      best_streak_days: String(streak.best_vc_streak),
      qualifying_days_display: `${streak.qualified_vc_days_total} hari (minimal 10 menit per hari)`,
      target_avatar_url: target_user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: `VC Hangout Streak — ${escapeMarkdown(target_user.displayName)}`,
      fallback_body: [
        `**Streak sekarang:** ${current_streak} hari`,
        `**Streak terbaik:** ${streak.best_vc_streak} hari`,
        `**Hari yang kehitung:** ${streak.qualified_vc_days_total} hari (minimal 10 menit per hari)`,
      ].join("\n"),
      avatar_url: target_user.displayAvatarURL({ size: 256 }),
      avatar_description: `Avatar ${target_user.displayName}`,
    },
  );

}

async function load_leaderboard_avatars(
  interaction: ChatInputCommandInteraction<"cached">,
  entries: activity.leaderboard_entry[],
): Promise<leaderboard_display_entry[]> {

  return Promise.all(entries.map(async (entry) => {
    let target_user: User | undefined = interaction.client.users.cache.get(entry.user_id);

    if (!target_user) {
      try {
        target_user = await interaction.client.users.fetch(entry.user_id);
      } catch {
        target_user = undefined;
      }
    }

    return {
      user_id: entry.user_id,
      activity_count: Number(entry.activity_count),
      avatar_url: target_user?.displayAvatarURL({ size: 128 })
        ?? interaction.user.displayAvatarURL({ size: 128 }),
    };
  }));

}

function add_leaderboard_values(
  values: Record<string, string>,
  category: "chat" | "voice",
  entries: leaderboard_display_entry[],
  unit: string,
): void {

  values[`${category}_user_count`] = String(entries.length);

  for (let rank = 1; rank <= 5; rank += 1) {
    const entry = entries[rank - 1];
    const user_key = `${category}_user_${rank}`;
    const value_key = category === "chat" ? `chat_messages_${rank}` : `voice_time_${rank}`;

    values[`${user_key}_mention`] = entry
      ? `<@${entry.user_id}>`
      : entries.length === 0 && rank === 1
        ? "Belum ada data"
        : "";
    values[value_key] = entry
      ? unit === "pesan"
        ? new Intl.NumberFormat("id-ID").format(entry.activity_count)
        : format_duration(entry.activity_count)
      : entries.length === 0 && rank === 1
        ? "—"
        : "";
    values[`${user_key}_avatar_url`] = entry?.avatar_url ?? "";
  }

}

function format_duration(value: string | number): string {

  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const total_minutes = Math.floor(seconds / 60);
  const hours = Math.floor(total_minutes / 60);
  const minutes = total_minutes % 60;

  if (hours > 0) {
    return `${hours} jam ${minutes} menit`;
  }

  return `${total_minutes} menit`;

}

function format_date(day: string): string {

  const [year, month, date] = day.split("-");

  if (!year || !month || !date) {
    return day;
  }

  return `${date}/${month}/${year}`;

}
