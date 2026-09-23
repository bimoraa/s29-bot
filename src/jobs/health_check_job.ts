import * as logger from "../shared/logger/logger.js";
import * as database from "../infrastructure/database/database.js";
import * as redis from "../infrastructure/redis/redis.js";

export async function run_infrastructure_health_check(): Promise<void> {

  const checks = await Promise.allSettled([
    database.check(),
    redis.check(),
  ]);
  const failed_checks = checks.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [];
    }

    return [index === 0 ? "database" : "redis"];
  });

  if (failed_checks.length > 0) {
    logger.log("error", "infrastructure_health_check_failed", {
      dependencies: failed_checks.join(","),
    });
    throw new Error(
      "Infrastructure health check failed: " + failed_checks.join(", ") + ".",
    );
  }

}
