import { Events } from "discord.js";
import { config as load_dotenv } from "dotenv";
import { create_app_context } from "./container.js";
import { setup_shutdown } from "./shutdown.js";
import { process_job } from "../jobs/jobs.js";
import { start_scheduler } from "../jobs/scheduler.js";
import * as database from "../infrastructure/database/database.js";
import * as activity from "../features/activity/__activity.js";
import * as http_server from "../infrastructure/http/server.js";
import * as metrics from "../infrastructure/metrics/metrics.js";
import * as queue from "../infrastructure/queue/queue.js";
import * as redis from "../infrastructure/redis/redis.js";
import { error_message } from "../shared/helpers/error_message.js";
import * as logger from "../shared/logger/logger.js";
import * as voice_guard from "../features/voice/__voice_guard.js";

/** BEGIN startup aplikasi */

export async function bootstrap(): Promise<void> {

  // load_config baca process.env, jadi dotenv harus jalan dulu
  load_dotenv();

  const context = create_app_context();
  const run_shutdown = setup_shutdown(context);

  context.client.once(Events.ClientReady, (ready_client) => {
    void voice_guard.start(ready_client, {
      guild_id: context.config.voice_guild_id,
      channel_id: context.config.voice_channel_id,
      }).catch((error: unknown) => {
        logger.log("error", "voice_guard_start_failed", {
        message: error_message(error),
      });
    });
  });

  try {
    await database.connect(context.config.database);
    await activity.initialize();
    await redis.connect(context.config.redis_url);
    metrics.start();
    await queue.start(context.config.redis_url, process_job);
    await start_scheduler();
    await http_server.listen(
      context.http_server,
      context.config.http_host,
      context.config.http_port,
    );
    await context.client.login(context.config.bot_token);
  } catch (error) {
    await run_shutdown();
    throw error;
  }

}

/** END startup aplikasi */
