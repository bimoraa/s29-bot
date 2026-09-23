import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "@prometheus-io/client";

type HttpMethodLabel =
  | "CONNECT"
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "TRACE"
  | "OTHER";

// method di luar daftar pakai OTHER, bukan label baru
function label_http_method(method: string): HttpMethodLabel {

  switch (method) {
    case "CONNECT":
    case "DELETE":
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "PATCH":
    case "POST":
    case "PUT":
    case "TRACE":
      return method;
    default:
      return "OTHER";
  }

}

export const registry = new Registry();
const http_requests = new Counter({
  name: "s29_http_requests_total",
  help: "Total HTTP requests handled by the bot.",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});
const http_request_duration = new Histogram({
  name: "s29_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route"],
  registers: [registry],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
const jobs_completed = new Counter({
  name: "s29_jobs_completed_total",
  help: "Total queue jobs completed.",
  labelNames: ["job_name"],
  registers: [registry],
});
const jobs_failed = new Counter({
  name: "s29_jobs_failed_total",
  help: "Total queue job attempts that failed.",
  labelNames: ["job_name"],
  registers: [registry],
});
const job_duration = new Histogram({
  name: "s29_job_duration_seconds",
  help: "Queue job execution duration in seconds.",
  labelNames: ["job_name"],
  registers: [registry],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** BEGIN metrik */

export function start(): void {

  collectDefaultMetrics({
    register: registry,
    prefix: "s29_",
  });

}

export function record_http_request(
  method: string,
  route: string,
  status_code: number,
  duration_seconds: number,
): void {

  const method_label = label_http_method(method);
  const labels = {
    method: method_label,
    route,
    status_code: String(status_code),
  };

  http_requests.inc(labels);
  http_request_duration.observe({ method: method_label, route }, duration_seconds);

}

export function record_job_completed(job_name: string, duration_seconds: number): void {

  jobs_completed.inc({ job_name });
  job_duration.observe({ job_name }, duration_seconds);

}

export function record_job_failed(job_name: string, duration_seconds: number): void {

  jobs_failed.inc({ job_name });
  job_duration.observe({ job_name }, duration_seconds);

}

/** END metrik */
