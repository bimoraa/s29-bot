import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

const timestamp_formats = [
  { name: "Short time", value: "t" },
  { name: "Long time", value: "T" },
  { name: "Short date", value: "d" },
  { name: "Long date", value: "D" },
  { name: "Short date and time", value: "f" },
  { name: "Long date and time", value: "F" },
  { name: "Relative time", value: "R" },
] as const;

export const command = new SlashCommandBuilder()
  .setName("timestamp")
  .setDescription("Bikin timestamp Discord dari tanggal atau Unix time.")
  .addStringOption((option) => option
    .setName("date")
    .setDescription("Tanggal yang bisa dibaca bot, atau Unix time dalam detik/milidetik.")
    .setMaxLength(100)
    .setRequired(true))
  .addStringOption((option) => option
    .setName("format")
    .setDescription("Cara Discord menampilkan tanggalnya.")
    .addChoices(...timestamp_formats)
    .setRequired(false));

function parse_timestamp(input: string): number | null {

  const normalized_input = input.trim();

  if (!normalized_input) {
    return null;
  }

  let timestamp_milliseconds: number;

  if (/^[+-]?\d+$/.test(normalized_input)) {
    const unix_value = Number(normalized_input);

    if (!Number.isSafeInteger(unix_value)) {
      return null;
    }

    timestamp_milliseconds = Math.abs(unix_value) < 100_000_000_000
      ? unix_value * 1_000
      : unix_value;
  } else {
    timestamp_milliseconds = Date.parse(normalized_input);
  }

  if (!Number.isFinite(timestamp_milliseconds)) {
    return null;
  }

  const date = new Date(timestamp_milliseconds);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.floor(timestamp_milliseconds / 1_000);

}

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const input = interaction.options.getString("date", true);
  const format = interaction.options.getString("format") ?? "F";
  const unix_timestamp = parse_timestamp(input);

  if (unix_timestamp === null) {
    await panel.send_template(
      interaction,
      "timestamp_invalid.json",
      {
        invoker_avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
      },
      {
        fallback_title: "Tanggal nggak valid",
        fallback_body: "Masukkan tanggal yang bisa dibaca, Unix time dalam detik, atau Unix time dalam milidetik.",
        avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
      },
    );
    return;
  }

  await panel.send_template(
    interaction,
    "timestamp.json",
    {
      unix_timestamp: String(unix_timestamp),
      timestamp_format: format,
      invoker_avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: "Discord timestamp",
      fallback_body: `- **Preview:** <t:${unix_timestamp}:${format}>\n- **Unix:** \`${unix_timestamp}\``,
      avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
    },
  );

}
