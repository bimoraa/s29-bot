import {
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

export const command = new SlashCommandBuilder()
  .setName("banner")
  .setDescription("Lihat banner profile user.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang bannernya mau dilihat.")
    .setRequired(false));

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const selected_user = interaction.options.getUser("user") ?? interaction.user;
  const target_user = await selected_user.fetch(true);
  const banner_url = target_user.bannerURL({ size: 1_024 });
  const target_display_name = target_user.globalName ?? target_user.username;
  const requester_display_name = interaction.user.globalName ?? interaction.user.username;
  const target_avatar_url = target_user.displayAvatarURL({ size: 256 });

  if (banner_url === null || banner_url === undefined) {
    await panel.send_template(
      interaction,
      "banner_missing.json",
      {
        target_display_name: escapeMarkdown(target_display_name),
        target_avatar_url,
      },
      {
        fallback_title: "Banner nggak ketemuu",
        fallback_body: `${escapeMarkdown(target_display_name)} belum pasang banner profile`,
        avatar_url: target_avatar_url,
        avatar_description: `Avatar ${target_display_name}`,
      },
    );
    return;
  }

  await panel.send_template(
    interaction,
    "banner.json",
    {
      requester_display_name,
      target_display_name,
      target_user_id: target_user.id,
      target_avatar_url,
      banner_url,
    },
    {
      fallback_title: `Banner — ${escapeMarkdown(target_display_name)}`,
      fallback_body: `**User ID:** ${target_user.id}`,
      avatar_url: target_avatar_url,
      avatar_description: `Avatar ${target_display_name}`,
      image_urls: [banner_url],
      image_descriptions: [`Banner ${target_display_name}`],
    },
  );

}
