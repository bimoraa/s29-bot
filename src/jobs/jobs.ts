import type { Job } from "bullmq";
import { run_infrastructure_health_check } from "./health_check_job.js";

const job_handlers = new Map<string, () => Promise<void>>([
  ["infrastructure.health_check", run_infrastructure_health_check],
]);

export async function process_job(job: Job): Promise<void> {

  const handler = job_handlers.get(job.name);

  if (!handler) {
    throw new Error("No handler is registered for job " + job.name + ".");
  }

  await handler();

}
