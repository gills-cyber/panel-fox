/** A small Ollama /api/chat client. Answers are streamed so long generations never time out. */
import { JSONRepairError, parseJsonLoose } from "./jsonfix.ts";

export class OllamaError extends Error {}

export interface ModelClient {
  checkModels(models: string[]): Promise<string[]>;
  chatJson(
    model: string,
    system: string,
    user: string,
    images?: string[] | null,
    schema?: Record<string, unknown> | null,
    temperature?: number,
    retries?: number,
  ): Promise<unknown>;
}

export type OllamaModel = { name: string; size: number; params: string; capabilities: string[] };

/** "localhost:11434" -> "http://localhost:11434"; null for anything that is not an http(s) address. */
export function normalizeHost(raw: string): string | null {
  let h = raw.trim();
  if (!h) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = "http://" + h;
  try {
    const u = new URL(h);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** True when the address is this computer. */
export function isLocalHost(raw: string): boolean {
  const h = normalizeHost(raw);
  if (!h) return true;
  const name = new URL(h).hostname;
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name.endsWith(".localhost");
}

export class OllamaClient implements ModelClient {
  host: string;
  numCtx: number | null;
  signal?: AbortSignal;
  onToken?: (chars: number) => void;

  constructor(host = "http://localhost:11434", numCtx: number | null = null, signal?: AbortSignal) {
    this.host = normalizeHost(host) ?? host.replace(/\/+$/, "");
    this.numCtx = numCtx;
    this.signal = signal;
  }

  private async request(path: string, payload?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.host + path, {
        method: payload === undefined ? "GET" : "POST",
        headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: this.signal,
      });
    } catch (e) {
      if (this.signal?.aborted) throw e;
      throw new OllamaError(`Cannot reach Ollama at ${this.host} (${e instanceof Error ? e.message : e}). Is Ollama running?`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OllamaError(`Ollama HTTP ${res.status} on ${path}: ${body.slice(0, 500)}`);
    }
    return res;
  }

  async tags(): Promise<{ models?: { name?: string; model?: string; size?: number; digest?: string; details?: { parameter_size?: string } }[] }> {
    const res = await this.request("/api/tags");
    return (await res.json()) as never;
  }

  /** The models from `models` that are not pulled locally. */
  async checkModels(models: string[]): Promise<string[]> {
    const tags = await this.tags();
    const have = new Set<string>();
    for (const m of tags.models ?? []) {
      const name = m.name ?? "";
      have.add(name);
      if (name.endsWith(":latest")) have.add(name.slice(0, -":latest".length));
    }
    return models.filter((m) => !have.has(m));
  }

  /** Installed models and what each can do (vision or not). */
  async listModels(): Promise<OllamaModel[]> {
    const tags = await this.tags();
    const out: OllamaModel[] = [];
    for (const m of tags.models ?? []) {
      const name = m.name || m.model || "";
      if (!name) continue;
      let caps: string[] = [];
      try {
        const res = await this.request("/api/show", { model: name });
        caps = ((await res.json()) as { capabilities?: string[] }).capabilities ?? [];
      } catch {
        caps = [];
      }
      if (!caps.length && name.toLowerCase().includes("vl")) caps = ["vision"];
      out.push({ name, size: m.size ?? 0, params: m.details?.parameter_size ?? "", capabilities: caps });
    }
    return out;
  }

  private async chat(payload: Record<string, unknown>): Promise<string> {
    const res = await this.request("/api/chat", { ...payload, stream: true });
    const reader = res.body?.getReader();
    if (!reader) return "";
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (msg.error) throw new OllamaError(`Ollama HTTP 500 on /api/chat: ${msg.error}`);
        content += msg.message?.content ?? "";
        this.onToken?.(content.length);
      }
      if (done) break;
    }
    if (buf.trim()) {
      const msg = JSON.parse(buf) as { message?: { content?: string }; error?: string };
      if (msg.error) throw new OllamaError(`Ollama HTTP 500 on /api/chat: ${msg.error}`);
      content += msg.message?.content ?? "";
    }
    return content;
  }

  /**
   * Ask for JSON and return the parsed value. Uses structured outputs (the
   * schema) and falls back to plain "json" when the server refuses the schema.
   * Broken JSON is sent back once with a request to correct it.
   */
  async chatJson(
    model: string,
    system: string,
    user: string,
    images: string[] | null = null,
    schema: Record<string, unknown> | null = null,
    temperature = 0.7,
    retries = 2,
  ): Promise<unknown> {
    let messages: Record<string, unknown>[] = [{ role: "system", content: system }];
    const userMsg: Record<string, unknown> = { role: "user", content: user };
    if (images && images.length) userMsg.images = images;
    messages.push(userMsg);
    let fmt: unknown = schema ?? "json";
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const options: Record<string, unknown> = { temperature };
      if (this.numCtx) options.num_ctx = this.numCtx;
      let content: string;
      try {
        content = await this.chat({ model, messages, format: fmt, options });
      } catch (e) {
        if (e instanceof OllamaError && fmt !== "json" && e.message.toLowerCase().includes("format")) {
          fmt = "json"; // an older server without schema support
          lastErr = e;
          continue;
        }
        throw e;
      }
      try {
        return parseJsonLoose(content);
      } catch (e) {
        if (!(e instanceof JSONRepairError)) throw e;
        lastErr = e;
        messages = [
          ...messages.slice(0, 2),
          { role: "assistant", content },
          { role: "user", content: "That was not valid JSON. Reply again with ONLY the corrected JSON object, nothing else." },
        ];
      }
    }
    throw new OllamaError(`Model ${model} did not return valid JSON: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  }
}
