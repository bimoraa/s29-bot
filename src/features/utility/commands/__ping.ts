import {
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

export const command = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Cek latency bot dan gateway Discord.");

export async function handle(
  interaction: ChatInputCommandInteraction<"cached">,
  server_location: string,
): Promise<void> {

  const gateway_ping = interaction.client.ws.ping;
  const response_latency = Date.now() - interaction.createdTimestamp;
  const gateway_line = Number.isFinite(gateway_ping) && gateway_ping >= 0
    ? `${Math.round(gateway_ping)} ms`
    : "Connecting";

  await panel.send_template(
    interaction,
    "ping.json",
    {
      gateway_latency: gateway_line,
      interaction_latency: `${response_latency} ms`,
      boticon: interaction.client.user?.displayAvatarURL({ size: 256 })
        ?? interaction.user.displayAvatarURL({ size: 256 }),
      server_location: escapeMarkdown(server_location),
    },
    {
      fallback_title: "Pongg!",
      fallback_body: [
        `- **Gateway:** ${gateway_line}`,
        `- **Interaction:** ${response_latency} ms`,
        `- **Server:** ${escapeMarkdown(server_location)}`,
      ].join("\n"),
      avatar_url: interaction.client.user?.displayAvatarURL({ size: 256 })
        ?? interaction.user.displayAvatarURL({ size: 256 }),
    },
  );

}
