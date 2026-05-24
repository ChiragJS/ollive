export interface SseEvent {
  event: string;
  data: string;
}

export interface StreamPostOptions {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

export async function streamSsePost(opts: StreamPostOptions): Promise<void> {
  const response = await fetch(opts.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(errorMessageFromResponseText(text, `SSE request failed: ${response.status}`));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent = "message";
  const dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) return;
    opts.onEvent({ event: currentEvent, data: dataLines.join("\n") });
    dataLines.length = 0;
    currentEvent = "message";
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        flush();
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const rest = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") currentEvent = rest;
      else if (field === "data") dataLines.push(rest);
    }
  }
  flush();
}

function errorMessageFromResponseText(text: string, fallback: string): string {
  if (!text.trim()) return fallback;
  try {
    const payload = JSON.parse(text);
    if (typeof payload?.detail === "string") return payload.detail;
    if (typeof payload?.detail?.message === "string") return payload.detail.message;
    if (typeof payload?.message === "string") return payload.message;
  } catch {
    return text;
  }
  return fallback;
}
