import { Reading, Rejected, validate } from "./outbox";

export function endpoint(input: string): string {
  const url = new URL(input);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "10.0.2.2";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error("Use HTTPS, or a local simulator HTTP address.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Enter an API origin without paths, credentials, or query parameters.");
  return url.origin;
}

export async function submit(baseUrl: string, token: string, reading: Reading): Promise<void> {
  validate(reading);
  const origin = endpoint(baseUrl);
  if (token.length < 32) throw new Error("Enter the configured writer key.");
  const cancellation = new AbortController();
  const timeout = setTimeout(() => cancellation.abort(), 5000);
  try {
    const response = await fetch(origin + "/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(reading),
      signal: cancellation.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Rejected(response.status, "API rejected the request (" + response.status + ").");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("reading" in result) ||
        !result.reading || typeof result.reading !== "object" ||
        !("operationId" in result.reading) || result.reading.operationId !== reading.operationId ||
        !("meterId" in result.reading) || result.reading.meterId !== reading.meterId ||
        !("valueWh" in result.reading) || result.reading.valueWh !== reading.valueWh)
      throw new Error("Unexpected acknowledgement. The pending reading is retained.");
  } finally { clearTimeout(timeout); }
}
