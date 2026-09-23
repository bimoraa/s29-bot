import {
  Events,
  type Client,
} from "discord.js";
import * as music_presence from "../../features/music_presence/__music_presence.js";
import * as logger from "../../shared/logger/logger.js";

export function register(client: Client): void {

  client.once(Events.ClientReady, (ready_client) => {
    music_presence.start(ready_client.user);

    logger.log("info", "client_ready", {
      user: ready_client.user.tag,
      guilds: ready_client.guilds.cache.size,
    });
  });

}
