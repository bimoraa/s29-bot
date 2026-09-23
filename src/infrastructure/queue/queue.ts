import {
  Queue,
  Worker,
  type Job,
  type JobsOptions,
} from "bullmq";
import * as logger from "../../shared/logger/logger.js";
import * as metrics from "../metrics/metrics.js";
import * as redis from "../redis/redis.js";

const queue_name = "s29-bot-jobs";
const default_job_options: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1_000,
  },
  removeOnComplete: {
    age: 3_600,
    count: 1_000,
  },
  removeOnFail: {
    age: 86_400,
    count: 5_000,
  },
};

type JobProcessor = (job: Job) => Promise<unknown>;

let job_queue: Queue | undefined;
let worker: Worker | undefined;

/** BEGIN antrean */

function get_job_queue(): Queue {

  if (!job_queue) {
    throw new Error("Queue is not connected.");
  }

  return job_queue;

}

export async function start(redis_url: string, processor: JobProcessor): Promise<void> {

  if (job_queue || worker) {
    return;
  }

  const worker_connection = redis.connection_options(redis_url);
  const queue_connection = {
    ...worker_connection,
    maxRetriesPerRequest: 1,
  };
  const next_queue = new Queue(queue_name, {
    connection: queue_connection,
    defaultJobOptions: default_job_options,
  });
  const next_worker = new Worker(queue_name, processor, {
    connection: worker_connection,
    concurrency: 2,
  });

  next_queue.on("error", (error) => {
    logger.log("error", "queue_connection_error", {
      message: error.message,
    });
  });

  next_worker.on("error", (error) => {
    logger.log("error", "queue_worker_error", {
      message: error.message,
    });
  });

  next_worker.on("completed", (job) => {
    const duration_seconds = Math.max(
      0,
      (Date.now() - (job.processedOn ?? Date.now())) / 1_000,
    );

    metrics.record_job_completed(job.name, duration_seconds);
  });

  next_worker.on("failed", (job, error) => {
    const duration_seconds = Math.max(
      0,
      (Date.now() - (job?.processedOn ?? Date.now())) / 1_000,
    );

    metrics.record_job_failed(job?.name ?? "unknown", duration_seconds);
    logger.log("error", "queue_job_failed", {
      job_name: job?.name ?? "unknown",
      message: error.message,
    });
  });

  job_queue = next_queue;
  worker = next_worker;

  try {
    await Promise.all([
      next_queue.waitUntilReady(),
      next_worker.waitUntilReady(),
    ]);
  } catch (error) {
    await close();
    throw error;
  }

  logger.log("info", "queue_connected", {
    name: queue_name,
  });

}

export async function check(): Promise<void> {

  await get_job_queue().getJobCounts("waiting", "active", "delayed");

}

export function add<TData = Record<string, unknown>>(
  name: string,
  data: TData,
  options?: JobsOptions,
) {

  return get_job_queue().add(name, data, options);

}

export function schedule<TData = Record<string, unknown>>(
  scheduler_id: string,
  every: number,
  name: string,
  data: TData,
): Promise<Job> {

  return get_job_queue().upsertJobScheduler(
    scheduler_id,
    { every },
    {
      name,
      data,
      opts: default_job_options,
    },
  );

}

export async function close(): Promise<void> {

  const current_worker = worker;
  const current_queue = job_queue;
  worker = undefined;
  job_queue = undefined;

  const errors: unknown[] = [];

  if (current_worker) {
    try {
      await current_worker.close();
    } catch (error) {
      errors.push(error);
    }
  }

  if (current_queue) {
    try {
      await current_queue.close();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Queue shutdown failed.");
  }

  logger.log("info", "queue_closed");

}

/** END antrean */
