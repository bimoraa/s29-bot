import type { AppContext } from "./context.js";
import * as activity from "../features/activity/__activity.js";
import * as music_presence from "../features/music_presence/__music_presence.js";
import * as database from "../infrastructure/database/database.js";
import * as http_server from "../infrastructure/http/server.js";
import * as queue from "../infrastructure/queue/queue.js";
import * as redis from "../infrastructure/redis/redis.js";
import { error_message } from "../shared/helpers/error_message.js";
import * as logger from "../shared/logger/logger.js";
import * as voice_guard from "../features/voice/__voice_guard.js";

/** BEGIN penutupan bertahap */

async function close_shutdown_component(name: string, action: () => Promise<void>): Promise<void> {

  // kalau satu close gagal, lanjut coba tutup yang lain
  try {
    await action();
  } catch (error) {
    logger.log("error", "shutdown_component_close_failed", {
      component: name,
      message: error_message(error),
    });
    process.exitCode = 1;
  }

}

export function setup_shutdown(context: AppContext): (signal?: NodeJS.Signals) => Promise<void> {

  let shutdown_promise: Promise<void> | undefined;

  const run_shutdown = (signal?: NodeJS.Signals): Promise<void> => {

    if (shutdown_promise) {
      return shutdown_promise;
    }

    logger.log("info", "shutdown_started", signal ? { signal } : {});
    const activity_stop = activity.stop();
    voice_guard.stop(context.client);
    music_presence.stop();
    context.client.destroy();

    shutdown_promise = (async () => {
      await close_shutdown_component("activity", async () => activity_stop);
      await close_shutdown_component(
        "http",
        () => http_server.close(context.http_server),
      );
      await close_shutdown_component("queue", queue.close);

      await Promise.all([
        close_shutdown_component("database", database.close),
        close_shutdown_component("redis", redis.close),
      ]);
    })();

    return shutdown_promise;

  };

  process.once("SIGINT", () => {
    void run_shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void run_shutdown("SIGTERM");
  });

  return run_shutdown;

}

/** END penutupan bertahap */
