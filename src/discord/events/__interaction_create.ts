import {
  Events,
  type Client,
} from "discord.js";
import * as activity_commands from "../../features/activity/commands/__activity.js";
import * as utility_commands from "../commands/__utility.js";
import * as logger from "../../shared/logger/logger.js";

export function register(client: Client, server_location: string): void {

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const response = activity_commands.handles(interaction.commandName)
      ? activity_commands.handle(interaction)
      : utility_commands.handle(interaction, server_location);

    void response.catch(() => {
      logger.log("error", "command_response_failed", {
        command: interaction.commandName,
      });
    });
  });

}
