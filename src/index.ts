import { bootstrap } from "./app/bootstrap.js";
import { error_message } from "./shared/helpers/error_message.js";
import { log } from "./shared/logger/logger.js";

void bootstrap().catch((error: unknown) => {

  const message = error_message(error);

  log("fatal", "startup_failed", {
    message,
  });

  process.exitCode = 1;

});
