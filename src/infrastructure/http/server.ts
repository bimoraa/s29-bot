import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { error_message } from "../../shared/helpers/error_message.js";
import * as logger from "../../shared/logger/logger.js";
import * as database from "../database/database.js";
import * as metrics from "../metrics/metrics.js";
import * as queue from "../queue/queue.js";
import * as redis from "../redis/redis.js";

/** BEGIN server http */

function route_pathname(request_url: string | undefined): string {

  try {
    return new URL(request_url ?? "/", "http://localhost").pathname;
  } catch {
    return "/invalid";
  }

}

function route_label(pathname: string): string {

  // URL yang beda-beda nggak usah jadi label metrik sendiri
  if (pathname === "/livez" || pathname === "/readyz" || pathname === "/metrics") {
    return pathname;
  }

  return "other";

}

function write_text(response: ServerResponse, status_code: number, body: string): void {

  response.writeHead(status_code, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);

}

async function check_readiness(is_discord_ready: () => boolean): Promise<boolean> {

  if (!is_discord_ready()) {
    return false;
  }

  const results = await Promise.allSettled([
    database.check(),
    redis.check(),
    queue.check(),
  ]);

  return results.every((result) => result.status === "fulfilled");

}

async function handle_http_request(
  request: IncomingMessage,
  response: ServerResponse,
  is_discord_ready: () => boolean,
): Promise<void> {

  const pathname = route_pathname(request.url);
  const route = route_label(pathname);
  const started_at = process.hrtime.bigint();
  let status_code = 500;

  try {
    if (request.method !== "GET") {
      status_code = 405;
      response.writeHead(status_code, {
        Allow: "GET",
      });
      response.end();
      return;
    }

    if (pathname === "/livez") {
      status_code = 200;
      write_text(response, status_code, "ok\n");
      return;
    }

    if (pathname === "/readyz") {
      const ready = await check_readiness(is_discord_ready);
      status_code = ready ? 200 : 503;
      write_text(response, status_code, ready ? "ready\n" : "not ready\n");
      return;
    }

    if (pathname === "/metrics") {
      const body = await metrics.registry.metrics();
      status_code = 200;
      response.writeHead(status_code, {
        "Cache-Control": "no-store",
        "Content-Type": metrics.registry.contentType,
      });
      response.end(body);
      return;
    }

    status_code = 404;
    response.writeHead(status_code);
    response.end();
  } catch (error) {
    logger.log("error", "http_request_failed", {
      message: error_message(error),
      route,
    });

    if (!response.headersSent) {
      write_text(response, status_code, "internal server error\n");
    } else {
      response.destroy();
    }
  } finally {
    const duration_seconds = Number(process.hrtime.bigint() - started_at) / 1_000_000_000;
    metrics.record_http_request(
      request.method ?? "UNKNOWN",
      route,
      status_code,
      duration_seconds,
    );
  }

}

export function create(is_discord_ready: () => boolean): Server {

  return createServer((request, response) => {
    void handle_http_request(request, response, is_discord_ready);
  });

}

export function listen(server: Server, host: string, port: number): Promise<void> {

  return new Promise<void>((resolve, reject) => {

    function handle_error(error: Error): void {

      server.off("listening", handle_listening);
      reject(error);

    }

    function handle_listening(): void {

      server.off("error", handle_error);
      logger.log("info", "http_server_listening", {
        host,
        port,
      });
      resolve();

    }

    server.once("error", handle_error);
    server.once("listening", handle_listening);
    server.listen(port, host);

  });

}

export async function close(server: Server): Promise<void> {

  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  logger.log("info", "http_server_closed");

}

/** END server http */
