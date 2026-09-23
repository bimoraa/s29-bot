import { randomUUID } from "node:crypto";
import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as avatar_command from "../../features/utility/commands/__avatar.js";
import * as banner_command from "../../features/utility/commands/__banner.js";
import * as calc_command from "../../features/utility/commands/__calc.js";
import * as ping_command from "../../features/utility/commands/__ping.js";
import * as serverinfo_command from "../../features/utility/commands/__serverinfo.js";
import * as timestamp_command from "../../features/utility/commands/__timestamp.js";
import * as userinfo_command from "../../features/utility/commands/__userinfo.js";
import * as panel from "./panel.js";
import * as logger from "../../shared/logger/logger.js";

type CommandHandler = (interaction: ChatInputCommandInteraction<"cached">, server_location: string) => Promise<void>;

const command_handlers: ReadonlyMap<string, CommandHandler> = new Map([
  [avatar_command.command.name, avatar_command.handle],
  [banner_command.command.name, banner_command.handle],
  [userinfo_command.command.name, userinfo_command.handle],
  [serverinfo_command.command.name, serverinfo_command.handle],
  [ping_command.command.name, ping_command.handle],
  [timestamp_command.command.name, timestamp_command.handle],
  [calc_command.command.name, calc_command.handle],
]);

export const utility_commands = [
  avatar_command.command,
  banner_command.command,
  userinfo_command.command,
  serverinfo_command.command,
  ping_command.command,
  timestamp_command.command,
  calc_command.command,
];

export async function handle(interaction: ChatInputCommandInteraction, server_location: string): Promise<void> {

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.inCachedGuild()) {
      await panel.send_template(
        interaction,
        "command_error.json",
        {
          error_title: "Server unavailable",
          error_message: "Run this command in a server where the bot is installed.",
        },
        {
          fallback_title: "Server unavailable",
          fallback_body: "Run this command in a server where the bot is installed.",
          avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
        },
      );
      return;
    }

    const command_handler = command_handlers.get(interaction.commandName);

    if (command_handler === undefined) {
      await panel.send_template(
        interaction,
        "command_error.json",
        {
          error_title: "Unknown command",
          error_message: "This utility command isn't available.",
        },
        {
          fallback_title: "Unknown command",
          fallback_body: "This utility command isn't available.",
          avatar_url: interaction.user.displayAvatarURL({ size: 256 }),
        },
      );
      return;
    }

    await command_handler(interaction, server_location);
  } catch {
    const error_code = randomUUID();

    logger.log("error", "utility_command_failed", {
      command: interaction.commandName,
      error_code,
    });

    await panel.send_error_panel(interaction, error_code);
  }

}
