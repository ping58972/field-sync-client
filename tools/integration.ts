import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Outbox, Storage } from "../src/outbox";
import { submit } from "../src/api";

class DiskStorage implements Storage {
  failNextWrite = false;
  constructor(private file: string) {}
  async read() {
    try { return await readFile(this.file, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async write(value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("injected local storage failure"); }
    await writeFile(this.file + ".tmp", value);
    await rename(this.file + ".tmp", this.file);
  }
}

async function launch(apiDll: string, database: string, writer: string, reader: string) {
  const process = spawn(globalThis.process.env.DOTNET_PATH ?? "dotnet", [apiDll], {
    env: { ...globalThis.process.env, MeterDbPath: database, MeterWriterKey: writer,
      MeterReaderKey: reader, ASPNETCORE_URLS: "http://127.0.0.1:0", ASPNETCORE_ENVIRONMENT: "Production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const origin = await new Promise<string>((ready, reject) => {
    const timer = setTimeout(() => { process.kill(); reject(new Error("API startup timed out")); }, 15000);
    let output = "";
    process.stdout.on("data", data => {
      output += data.toString();
      const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:[0-9]+)/);
      if (match) { clearTimeout(timer); ready(match[1]); }
    });
    process.on("error", error => { clearTimeout(timer); reject(error); });
    process.on("exit", code => { clearTimeout(timer); reject(new Error("API exited before readiness: " + code)); });
  });
  return { process, origin };
}

async function stop(process: ChildProcess) {
  if (process.exitCode !== null) return;
  const exited = once(process, "exit");
  process.kill("SIGTERM");
  const timer = setTimeout(() => process.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function main() {
  if (!process.argv[2]) throw new Error("Usage: npx tsx tools/integration.ts PATH_TO_Meter.Api.dll");
  const apiDll = resolve(process.argv[2]);
  const directory = await mkdtemp(join(tmpdir(), "field-sync-e2e-"));
  const writer = randomBytes(32).toString("hex");
  const reader = randomBytes(32).toString("hex");
  const storage = new DiskStorage(join(directory, "outbox.json"));
  let api: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const reading = { operationId: randomUUID(), meterId: "MTR-001", valueWh: 100 };
    await new Outbox(storage).enqueue(reading);
    api = await launch(apiDll, join(directory, "readings.db"), writer, reader);
    storage.failNextWrite = true;
    await assert.rejects(new Outbox(storage).sync(item => submit(api!.origin, writer, item)));
    assert.equal((await new Outbox(storage).list()).length, 1);
    assert.equal((await new Outbox(storage).sync(item => submit(api!.origin, writer, item))).sent, 1);
    const eventResponse = await fetch(api.origin + "/events", { headers: { Authorization: "Bearer " + reader } });
    assert.equal(eventResponse.status, 200);
    assert.equal((await eventResponse.json()).length, 1);

    const queue = new Outbox(storage);
    await queue.enqueue({ operationId: randomUUID(), meterId: "MTR-001", valueWh: 99 });
    const conflict = await queue.sync(item => submit(api!.origin, writer, item));
    assert.equal(conflict.blocked, 1);
    assert.equal(conflict.remaining, 1);
    await stop(api.process);
    api = await launch(apiDll, join(directory, "readings.db"), writer, reader);
    const latest = await fetch(api.origin + "/meters/MTR-001/latest",
      { headers: { Authorization: "Bearer " + reader } });
    assert.equal((await latest.json()).valueWh, 100);
    console.log("PASS offline persistence, real HTTP/SQLite, accepted-write replay, conflict retention, and API restart");
  } finally {
    if (api) await stop(api.process);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
