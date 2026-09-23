import {
  SlashCommandBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as panel from "../../../discord/commands/panel.js";

export const command = new SlashCommandBuilder()
  .setName("userinfo")
  .setDescription("Lihat info user di server ini.")
  .addUserOption((option) => option
    .setName("user")
    .setDescription("User yang mau dilihat.")
    .setRequired(false));

export async function handle(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {

  const selected_user = interaction.options.getUser("user") ?? interaction.user;
  const target_user = await selected_user.fetch(true);
  const target_member = interaction.options.getMember("user") ?? (
    target_user.id === interaction.user.id
      ? interaction.member
      : interaction.guild.members.cache.get(target_user.id) ?? null
  );
  const joined_timestamp = target_member?.joinedTimestamp ?? null;
  const member_roles = target_member === null
    ? null
    : target_member.roles.cache
      .filter((role) => role.id !== interaction.guild.id)
      .sort((left_role, right_role) => right_role.position - left_role.position);
  const visible_roles = member_roles?.map((role) => `<@&${role.id}>`).slice(0, 10) ?? [];
  const role_list = member_roles === null
    ? "Not a server member"
    : visible_roles.length === 0
      ? "None"
      : `${visible_roles.join(", ")}${member_roles.size > visible_roles.length ? `, +${member_roles.size - visible_roles.length} more` : ""}`;
  const badges = target_user.flags?.toArray()
    .map((flag) => flag.toLowerCase().replaceAll("_", " "))
    .join(", ") || "None visible";
  const joined_line = joined_timestamp === null
    ? "Not a server member"
    : `<t:${Math.floor(joined_timestamp / 1_000)}:F>`;
  const boosting_timestamp = target_member?.premiumSinceTimestamp ?? null;
  const timeout_timestamp = target_member?.communicationDisabledUntilTimestamp ?? null;
  const timeout_line = target_member === null
    ? "Not a server member"
    : timeout_timestamp !== null && timeout_timestamp > Date.now()
      ? `<t:${Math.floor(timeout_timestamp / 1_000)}:F>`
      : "No active timeout";
  const banner_url = target_user.bannerURL({ size: 1_024 }) ?? null;
  const avatar_url = target_member?.displayAvatarURL({ size: 1_024 })
    ?? target_user.displayAvatarURL({ size: 1_024 });
  const image_urls = banner_url === null ? [avatar_url] : [avatar_url, banner_url];
  const body = [
    `- **Username:** @${escapeMarkdown(target_user.username)}`,
    `- **Display name:** ${escapeMarkdown(target_user.globalName ?? "Belum diatur")}`,
    `- **Nama di server:** ${escapeMarkdown(target_member?.displayName ?? "Bukan member server")}`,
    `- **User ID:** ${target_user.id}`,
    `- **Mention:** <@${target_user.id}>`,
    `- **Akun bot:** ${target_user.bot ? "Iya" : "Bukan"}`,
    `- **Akun dibuat:** <t:${Math.floor(target_user.createdTimestamp / 1_000)}:F>`,
    `- **Badges:** ${badges}`,
    `- **Warna profil:** ${target_user.hexAccentColor ?? "Belum diatur"}`,
    `- **Avatar decoration:** ${target_user.avatarDecorationURL() === null ? "Nggak ada" : "Ada"}`,
    `- **Banner profile:** ${banner_url === null ? "Nggak ada" : "Ada"}`,
    `- **Server:** ${escapeMarkdown(interaction.guild.name)}`,
    `- **Nickname server:** ${target_member === null ? "Bukan member server" : escapeMarkdown(target_member.nickname ?? "Nggak ada")}`,
    `- **Gabung server:** ${joined_line}`,
    `- **Roles (${member_roles?.size ?? "N/A"}):** ${role_list}`,
    `- **Boost sejak:** ${boosting_timestamp === null ? "Nggak boost" : `<t:${Math.floor(boosting_timestamp / 1_000)}:F>`}`,
    `- **Timeout:** ${timeout_line}`,
  ].join("\n");
  const target_display_name = target_member?.displayName ?? target_user.displayName;

  const account_created_at = `<t:${Math.floor(target_user.createdTimestamp / 1_000)}:F>`;
  const boosting_since = boosting_timestamp === null
    ? "Nggak boost"
    : `<t:${Math.floor(boosting_timestamp / 1_000)}:F>`;

  await panel.send_template(
    interaction,
    "userinfo.json",
    {
      target_username: escapeMarkdown(target_user.username),
      target_global_name: escapeMarkdown(target_user.globalName ?? "Belum diatur"),
      target_server_display_name: escapeMarkdown(target_member?.displayName ?? "Bukan member server"),
      target_user_id: target_user.id,
      account_created_at,
      server_joined_at: joined_line,
      role_count: String(member_roles?.size ?? "N/A"),
      role_list,
      boosting_since,
      timeout_status: timeout_line,
      target_display_name: escapeMarkdown(target_display_name),
      userinfoavatar: avatar_url,
      target_avatar_url: avatar_url,
    },
    {
      fallback_title: `User Info — ${escapeMarkdown(target_display_name)}`,
      fallback_body: body,
      avatar_url,
      avatar_description: `Avatar ${target_display_name}`,
      image_urls,
      image_descriptions: banner_url === null
        ? [`Avatar ${target_display_name}`]
        : [`Avatar ${target_display_name}`, `Banner ${target_display_name}`],
    },
  );

}
