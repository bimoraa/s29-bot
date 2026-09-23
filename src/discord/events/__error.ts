import {
  Events,
  type Client,
} from "discord.js";
import * as logger from "../../shared/logger/logger.js";

export function register(client: Client): void {

  client.on(Events.Error, (error) => {
    logger.log("error", "discord_client_error", {
      message: error.message,
    });
  });

}
