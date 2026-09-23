import * as queue from "../infrastructure/queue/queue.js";

const health_job_interval_ms = 60_000;
const health_scheduler_id = "infrastructure-health";
const health_job_name = "infrastructure.health_check";

export async function start_scheduler(): Promise<void> {

  // start ulang nggak numpuk jadwal karena ID scheduler tetap
  await queue.schedule(
    health_scheduler_id,
    health_job_interval_ms,
    health_job_name,
    {},
  );

}
