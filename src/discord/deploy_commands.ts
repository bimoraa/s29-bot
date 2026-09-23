import {
  ApplicationIntegrationType,
  InteractionContextType,
  REST,
  Routes,
} from "discord.js";
import { config as load_dotenv } from "dotenv";
import * as activity_commands from "../features/activity/commands/__activity.js";
import { utility_commands } from "./commands/__utility.js";
import { error_message } from "../shared/helpers/error_message.js";
import * as logger from "../shared/logger/logger.js";

function get_required_env(name: string): string {

  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;

}

async function deploy_commands(): Promise<void> {

  load_dotenv();

  const bot_token = get_required_env("BOT_TOKEN");
  const application_id = get_required_env("DISCORD_APPLICATION_ID");
  const command_scope = get_required_env("DISCORD_COMMAND_SCOPE");
  const guild_id = process.env.DISCORD_GUILD_ID?.trim();

  if (!/^\d{17,20}$/.test(application_id)) {
    throw new Error("DISCORD_APPLICATION_ID must be a valid Discord application ID.");
  }

  if (command_scope !== "global" && command_scope !== "guild") {
    throw new Error('DISCORD_COMMAND_SCOPE must be either "global" or "guild".');
  }

  let commands_route: `/${string}`;

  if (command_scope === "guild") {
    if (!guild_id || !/^\d{17,20}$/.test(guild_id)) {
      throw new Error("DISCORD_GUILD_ID must be a valid Discord server ID for guild scope.");
    }

    commands_route = Routes.applicationGuildCommands(application_id, guild_id);
  } else {
    commands_route = Routes.applicationCommands(application_id);
  }

  const rest = new REST({ version: "10" }).setToken(bot_token);
  const registered_commands = [...utility_commands, ...activity_commands.commands];

  for (const command of registered_commands) {
    const command_body = command.toJSON();
    const request_body = command_scope === "global"
      ? {
        ...command_body,
        contexts: [InteractionContextType.Guild],
        integration_types: [ApplicationIntegrationType.GuildInstall],
      }
      : command_body;

    await rest.post(commands_route, { body: request_body });
    console.info(`Registered /${command_body.name} (${command_scope}).`);
  }

}

void deploy_commands().catch((error: unknown) => {
  const message = error_message(error);
  logger.log("fatal", "command_deployment_failed", { message });
  process.exitCode = 1;
});
