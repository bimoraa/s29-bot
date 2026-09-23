import {
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

export const command = new SlashCommandBuilder()
  .setName("avatar")
  .setDescription("Lihat avatar user.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang avatarnya mau dilihat.")
    .setRequired(false));

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const target_user = interaction.options.getUser("user") ?? interaction.user;
  const avatar_url = target_user.displayAvatarURL({ size: 1_024 });
  const target_display_name = target_user.globalName ?? target_user.username;
  const requester_display_name = interaction.user.globalName ?? interaction.user.username;

  await panel.send_template(
    interaction,
    "avatar.json",
    {
      requester_display_name,
      target_display_name,
      target_user_id: target_user.id,
      target_avatar_url: avatar_url,
    },
    {
      fallback_title: `Avatar — ${escapeMarkdown(target_display_name)}`,
      fallback_body: `**User ID:** ${target_user.id}`,
      avatar_url,
      avatar_description: `Avatar ${target_display_name}`,
      image_urls: [avatar_url],
      image_descriptions: [`Avatar ${target_display_name}`],
    },
  );

}
