import assert from "node:assert/strict";
import test from "node:test";
import { Outbox, Reading, Rejected, Storage } from "../src/outbox";
import { endpoint, submit } from "../src/api";

function reading(index = 1, valueWh = 100): Reading {
  return { operationId: "00000000-0000-4000-8000-" + String(index).padStart(12, "0"), meterId: "MTR-001", valueWh };
}
class MemoryStore implements Storage {
  value: string | null = null;
  failNextWrite = false;
  async read() { return this.value; }
  async write(value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("disk unavailable"); }
    this.value = value;
  }
}

test("offline enqueue survives queue reconstruction", async () => {
  const storage = new MemoryStore();
  await new Outbox(storage).enqueue(reading());
  assert.deepEqual(await new Outbox(storage).list(), [reading()]);
});

test("concurrent enqueues serialize persistent updates", async () => {
  const storage = new MemoryStore();
  const queue = new Outbox(storage);
  await Promise.all(Array.from({ length: 20 }, (_, index) => queue.enqueue(reading(index))));
  assert.equal((await queue.list()).length, 20);
});

test("transport failure retains pending readings", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading());
  await assert.rejects(queue.sync(async () => { throw new Error("offline"); }));
  assert.deepEqual(await queue.list(), [reading()]);
});

test("authentication failure remains retryable", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading());
  await assert.rejects(queue.sync(async () => { throw new Rejected(401, "unauthorized"); }));
  assert.equal((await queue.list())[0].blockedReason, undefined);
});

test("server conflict blocks for review and preserves the value", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading());
  await queue.enqueue(reading(2, 101));
  const result = await queue.sync(async item => {
    if (item.valueWh === 100) throw new Rejected(409, "decreasing");
  });
  assert.deepEqual(result, { sent: 1, blocked: 1, remaining: 1 });
  assert.equal((await queue.list())[0].valueWh, 100);
  await queue.discard(reading().operationId);
  assert.deepEqual(await queue.list(), []);
});

test("unreviewed entries cannot be discarded", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading());
  await assert.rejects(queue.discard(reading().operationId));
});

test("concurrent sync calls cannot send the same pending operation twice", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading());
  let calls = 0;
  await Promise.all([queue.sync(async () => { calls++; }), queue.sync(async () => { calls++; })]);
  assert.equal(calls, 1);
});

test("accepted request plus failed local commit retries the original operation", async () => {
  const storage = new MemoryStore();
  const queue = new Outbox(storage);
  await queue.enqueue(reading());
  const accepted = new Set<string>();
  const send = async (item: Reading) => { accepted.add(item.operationId); };
  storage.failNextWrite = true;
  await assert.rejects(queue.sync(send));
  assert.deepEqual(await new Outbox(storage).list(), [reading()]);
  await new Outbox(storage).sync(send);
  assert.equal(accepted.size, 1);
  assert.deepEqual(await queue.list(), []);
});

test("invalid saved data is reported without overwriting it", async () => {
  const storage = new MemoryStore();
  storage.value = '{"unexpected": true}';
  await assert.rejects(new Outbox(storage).enqueue(reading()));
  assert.equal(storage.value, '{"unexpected": true}');
});

test("numeric boundaries and GUID validation", async () => {
  const queue = new Outbox(new MemoryStore());
  await queue.enqueue(reading(1, 0));
  await queue.enqueue(reading(2, 1_000_000_000_000));
  for (const value of [-1, NaN, Infinity, 0.1, 1_000_000_000_001])
    await assert.rejects(queue.enqueue(reading(3, value)));
  await assert.rejects(queue.enqueue({ ...reading(4), operationId: "bad" }));
});

test("queue capacity is bounded at 100", async () => {
  const queue = new Outbox(new MemoryStore());
  for (let index = 0; index < 100; index++) await queue.enqueue(reading(index));
  await assert.rejects(queue.enqueue(reading(100)));
  assert.equal((await queue.list()).length, 100);
});

test("HTTPS and local development origins are validated", () => {
  assert.equal(endpoint("https://example.com"), "https://example.com");
  assert.equal(endpoint("http://10.0.2.2:5079"), "http://10.0.2.2:5079");
  for (const input of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=x"])
    assert.throws(() => endpoint(input));
});

test("API client checks response identity before removing a pending reading", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ reading: reading(2) }), { status: 201 });
    const queue = new Outbox(new MemoryStore());
    await queue.enqueue(reading());
    await assert.rejects(queue.sync(item => submit("http://localhost:5079", "x".repeat(32), item)));
    assert.equal((await queue.list()).length, 1);
  } finally { globalThis.fetch = original; }
});

test("API client sends exact contract and accepts matching response", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://localhost:5079/readings");
      assert.deepEqual(JSON.parse(String(init?.body)), reading());
      return new Response(JSON.stringify({ reading: reading(), replay: false }), { status: 201 });
    };
    await submit("http://localhost:5079", "x".repeat(32), reading());
  } finally { globalThis.fetch = original; }
});
