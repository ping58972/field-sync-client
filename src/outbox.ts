export type Reading = { operationId: string; meterId: string; valueWh: number };
export type Pending = Reading & { blockedReason?: string };
export interface Storage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}
export type Sender = (reading: Reading) => Promise<void>;
export class Rejected extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function validate(reading: Reading): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reading.operationId))
    throw new Error("Expected a canonical lower-case operation GUID.");
  if (!/^MTR-[0-9]{3}$/.test(reading.meterId)) throw new Error("Use MTR-001 or MTR-002.");
  if (!Number.isSafeInteger(reading.valueWh) || reading.valueWh < 0 || reading.valueWh > 1_000_000_000_000)
    throw new Error("Enter a whole-number cumulative reading from 0 to 1000000000000 Wh.");
}

export class Outbox {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: Storage) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work);
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async load(): Promise<Pending[]> {
    const raw = await this.storage.read();
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("Invalid saved outbox.");
    const seen = new Set<string>();
    for (const value of parsed) {
      if (value === null || typeof value !== "object" ||
          typeof value.operationId !== "string" || typeof value.meterId !== "string" ||
          typeof value.valueWh !== "number" ||
          (value.blockedReason !== undefined && typeof value.blockedReason !== "string"))
        throw new Error("Invalid saved reading.");
      validate(value as Pending);
      if (seen.has(value.operationId)) throw new Error("Duplicate saved operation.");
      seen.add(value.operationId);
    }
    return parsed as Pending[];
  }

  list(): Promise<Pending[]> { return this.exclusive(() => this.load()); }

  enqueue(reading: Reading): Promise<void> {
    return this.exclusive(async () => {
      validate(reading);
      const pending = await this.load();
      if (pending.length >= 100) throw new Error("Outbox is full. Sync or review blocked entries.");
      if (pending.some(item => item.operationId === reading.operationId)) throw new Error("Operation already queued.");
      pending.push({ ...reading });
      await this.storage.write(JSON.stringify(pending));
    });
  }

  discard(operationId: string): Promise<void> {
    return this.exclusive(async () => {
      const entries = await this.load();
      const entry = entries.find(item => item.operationId === operationId);
      if (!entry?.blockedReason) throw new Error("Only reviewed blocked entries can be discarded.");
      await this.storage.write(JSON.stringify(entries.filter(item => item.operationId !== operationId)));
    });
  }

  sync(send: Sender): Promise<{ sent: number; blocked: number; remaining: number }> {
    return this.exclusive(async () => {
      const pending = await this.load();
      let sent = 0;
      let blocked = 0;
      let index = 0;
      while (index < pending.length) {
        const item = pending[index];
        if (item.blockedReason) { index++; continue; }
        try {
          await send({ operationId: item.operationId, meterId: item.meterId, valueWh: item.valueWh });
        } catch (error) {
          if (error instanceof Rejected && [400, 404, 409].includes(error.status)) {
            pending[index] = { ...item, blockedReason: "Server rejected this reading (" + error.status + ")." };
            await this.storage.write(JSON.stringify(pending));
            blocked++;
            index++;
            continue;
          }
          throw error;
        }
        // Persist only after the server acknowledgement. If this write fails,
        // restart retries the original operation ID and the API deduplicates it.
        pending.splice(index, 1);
        await this.storage.write(JSON.stringify(pending));
        sent++;
      }
      return { sent, blocked, remaining: pending.length };
    });
  }
}
