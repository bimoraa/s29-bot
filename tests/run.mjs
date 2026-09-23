import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const project_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report_directory = path.join(project_root, "test-results");
const temporary_root = await mkdtemp(path.join(tmpdir(), "s29-bots-test-"));
const child_environment = create_child_environment();
const children = [];
let test_output = "";
let test_error = "";
let test_exit_code = 1;

try {
  const postgres_port = await get_free_port();
  const redis_port = await get_free_port();
  const test_user = child_environment.USER ?? child_environment.LOGNAME;
  if (!test_user) {
    throw new Error("The local test runner needs the current OS username.");
  }
  const postgres_directory = path.join(temporary_root, "postgres");
  const redis_directory = path.join(temporary_root, "redis");
  await mkdir(postgres_directory);
  await mkdir(redis_directory);

  const initdb_result = spawnSync("initdb", [
    "-D", postgres_directory,
    "--auth-local=trust",
    "--auth-host=trust",
    "--username", test_user,
    "--no-sync",
  ], {
    cwd: project_root,
    env: child_environment,
    encoding: "utf8",
    timeout: 30_000,
  });

  if (initdb_result.status !== 0) {
    throw new Error(`Could not create temporary PostgreSQL data: ${initdb_result.stderr || initdb_result.stdout}`);
  }

  const postgres = start_child("postgres", [
    "-D", postgres_directory,
    "-h", "127.0.0.1",
    "-p", String(postgres_port),
    "-F",
    "-c", "fsync=off",
    "-c", "synchronous_commit=off",
    "-c", "max_connections=20",
  ], redis_directory);
  const redis = start_child("redis-server", [
    "--bind", "127.0.0.1",
    "--port", String(redis_port),
    "--save", "",
    "--appendonly", "no",
    "--dir", redis_directory,
    "--protected-mode", "yes",
  ], redis_directory);

  await wait_for_postgres(postgres_port, test_user, postgres);
  await wait_for_tcp(redis_port, redis);

  const test_env = {
    ...child_environment,
    S29_TEST_DATABASE_HOST: "127.0.0.1",
    S29_TEST_DATABASE_PORT: String(postgres_port),
    S29_TEST_DATABASE_USER: test_user,
    S29_TEST_REDIS_URL: `redis://127.0.0.1:${redis_port}/15`,
  };

  const test_process = spawn(process.execPath, [
    "--test",
    "--test-reporter=spec",
    "--test-concurrency=1",
    "tests/core.test.mjs",
    "tests/integration.test.mjs",
  ], {
    cwd: project_root,
    env: test_env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(test_process);
  test_process.stdout.setEncoding("utf8");
  test_process.stderr.setEncoding("utf8");
  test_process.stdout.on("data", (chunk) => {
    test_output += chunk;
    process.stdout.write(chunk);
  });
  test_process.stderr.on("data", (chunk) => {
    test_error += chunk;
    process.stderr.write(chunk);
  });
  test_exit_code = await new Promise((resolve, reject) => {
    test_process.once("error", reject);
    test_process.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} catch (error) {
  test_error += `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
  process.stderr.write(test_error);
} finally {
  for (const child of children.reverse()) {
    await stop_child(child);
  }
  await rm(temporary_root, { recursive: true, force: true });
  await write_report(test_exit_code, test_output, test_error);
}

process.exitCode = test_exit_code;

function create_child_environment() {

  const allowlisted = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME"];
  return Object.fromEntries(allowlisted.flatMap((name) => (
    process.env[name] ? [[name, process.env[name]]] : []
  )));

}

async function get_free_port() {

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local test port.");
  }

  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;

}

function start_child(command, args, cwd) {

  const child = spawn(command, args, {
    cwd,
    env: child_environment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.error_text = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    child.error_text += chunk;
  });
  children.push(child);
  return child;

}

async function wait_for_postgres(port, user, child) {

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Temporary PostgreSQL exited early: ${child.error_text}`);
    }

    const pool = new Pool({
      host: "127.0.0.1",
      port,
      database: "postgres",
      user,
      password: "",
      connectionTimeoutMillis: 250,
    });

    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch {
      await pool.end();
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Temporary PostgreSQL did not become ready: ${child.error_text}`);

}

async function wait_for_tcp(port, child) {

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Temporary Redis exited early: ${child.error_text}`);
    }

    const connected = await new Promise((resolve) => {
      const probe = createConnection({ host: "127.0.0.1", port });
      probe.setTimeout(300, () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", () => resolve(false));
    });
    if (connected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Temporary Redis did not become ready: ${child.error_text}`);

}

async function stop_child(child) {

  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }

}

async function write_report(exit_code, stdout, stderr) {

  await mkdir(report_directory, { recursive: true });
  const passed = [...stdout.matchAll(/✔/g)].length;
  const failed = [...stdout.matchAll(/✖/g)].length + (exit_code === 0 ? 0 : 1);
  const status = exit_code === 0 ? "PASS" : "FAIL";
  const details = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>S29 bot automated test report</title>
  <style>
    :root { color-scheme: dark; font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #e6edf3; }
    body { margin: 0; padding: 48px; }
    main { max-width: 1100px; margin: auto; }
    header { display: flex; align-items: center; gap: 18px; border-bottom: 1px solid #30363d; padding-bottom: 24px; }
    .mark { border-radius: 999px; padding: 8px 14px; font-weight: 800; background: ${exit_code === 0 ? "#123d2a" : "#541f24"}; color: ${exit_code === 0 ? "#56d98a" : "#ff7b72"}; }
    h1 { font: 600 26px/1.2 system-ui, sans-serif; margin: 0; }
    .meta { color: #8b949e; margin-top: 8px; }
    .cards { display: flex; gap: 14px; margin: 24px 0; }
    .card { min-width: 130px; background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 14px 18px; }
    .number { font: 700 27px/1.1 system-ui, sans-serif; }
    .label { color: #8b949e; margin-top: 4px; }
    h2 { font: 600 17px system-ui, sans-serif; margin: 30px 0 10px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; color: #c9d1d9; }
    .scope { color: #8b949e; }
  </style>
</head>
<body>
  <main>
    <header><span class="mark">${status}</span><div><h1>S29 bot automated test run</h1><div class="meta">${new Date().toISOString()} · isolated local PostgreSQL + Redis · no live Discord calls</div></div></header>
    <section class="cards"><div class="card"><div class="number">${passed}</div><div class="label">passing checks</div></div><div class="card"><div class="number">${failed}</div><div class="label">failing checks</div></div></section>
    <div class="scope">Coverage: utility and activity commands, calculator/config validation, activity database and gateway handlers, voice guard preconditions, PostgreSQL transactions, Redis/BullMQ, job scheduler, health check, and HTTP probes/metrics.</div>
    <h2>Test output</h2><pre>${escape_html(details || "No test output was produced.")}</pre>
  </main>
</body>
</html>`;

  await writeFile(path.join(report_directory, "latest.html"), html, "utf8");
  await writeFile(path.join(report_directory, "latest.txt"), details || "No test output was produced.\n", "utf8");

}

function escape_html(value) {

  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

}
