import {
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

export const command = new SlashCommandBuilder()
  .setName("serverinfo")
  .setDescription("Lihat info server ini.");

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const guild = interaction.guild;
  const created_at = Math.floor(guild.createdTimestamp / 1_000);
  const icon_url = guild.iconURL({ size: 1_024 });
  const body = [
    `- **Server ID:** ${guild.id}`,
    `- **Owner:** <@${guild.ownerId}>`,
    `- **Members:** ${guild.memberCount}`,
    `- **Channels:** ${guild.channels.cache.size}`,
    `- **Roles:** ${guild.roles.cache.size}`,
    `- **Boosts:** ${guild.premiumSubscriptionCount ?? 0} (Tier ${guild.premiumTier})`,
    `- **Dibuat:** <t:${created_at}:F>`,
    `- **Icon:** ${icon_url === null ? "Nggak ada" : "Ada"}`,
  ].join("\n");

  await panel.send_template(
    interaction,
    "serverinfo.json",
    {
      server_name: escapeMarkdown(guild.name),
      server_id: guild.id,
      server_owner_id: guild.ownerId,
      member_count: String(guild.memberCount),
      channel_count: String(guild.channels.cache.size),
      role_count: String(guild.roles.cache.size),
      boost_count: String(guild.premiumSubscriptionCount ?? 0),
      boost_tier: String(guild.premiumTier),
      server_created_at: `<t:${created_at}:F>`,
      server_icon_status: icon_url === null ? "Nggak ada" : "Ada",
      servericon: icon_url ?? interaction.user.displayAvatarURL({ size: 256 }),
    },
    {
      fallback_title: `Info server — ${escapeMarkdown(guild.name)}`,
      fallback_body: body,
      avatar_url: icon_url ?? interaction.user.displayAvatarURL({ size: 256 }),
      avatar_description: `Icon ${guild.name}`,
    },
  );

}
