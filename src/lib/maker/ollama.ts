/** A small Ollama /api/chat client. Answers are streamed so long generations never time out. */
import { JSONRepairError, parseJsonLoose } from "./jsonfix.ts";

export class OllamaError extends Error {}
/** The model's answer stopped because it ran out of room (the context was full). */
export class AnswerCutOff extends OllamaError {}

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
  /** How long Ollama keeps a model in memory after a call (seconds, or -1 for always). */
  keepAlive: number | string;

  constructor(host = "http://localhost:11434", numCtx: number | null = null, signal?: AbortSignal, keepAlive: number | string = 3600) {
    this.host = normalizeHost(host) ?? host.replace(/\/+$/, "");
    this.numCtx = numCtx;
    this.signal = signal;
    this.keepAlive = keepAlive;
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
      // Ollama's own errors are {"error": "..."}: keep the whole message, shorten anything else
      let said = body.slice(0, 500);
      try {
        const j = JSON.parse(body) as { error?: unknown };
        if (typeof j.error === "string") said = JSON.stringify({ error: j.error.slice(0, 500) });
      } catch {
        /* not JSON */
      }
      throw new OllamaError(`Ollama HTTP ${res.status} on ${path}: ${said}`);
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

  /**
   * The models this run uses. Only the one being asked is kept loaded: the others are
   * unloaded first, so the model in use fits on the graphics card instead of spilling
   * onto the much slower CPU.
   */
  models: string[] = [];
  private active: string | null = null;
  private switching: Promise<void> | null = null;

  private async useModel(model: string): Promise<void> {
    if (!this.models.length) return;
    if (this.switching) await this.switching;
    if (this.active === model) return;
    if (!this.switching) {
      this.switching = (async () => {
        const plain = (n: string) => (n.endsWith(":latest") ? n.slice(0, -7) : n);
        let running: string[] = [];
        try {
          const res = await this.request("/api/ps");
          const body = (await res.json()) as { models?: { name?: string; model?: string }[] };
          running = (body.models ?? []).map((m) => plain(m.name || m.model || ""));
        } catch {
          running = [];
        }
        for (const m of this.models) {
          if (plain(m) === plain(model) || !running.includes(plain(m))) continue;
          try {
            const res = await this.request("/api/generate", { model: m, keep_alive: 0 });
            await res.text();
          } catch {
            /* unloading is only a speed-up */
          }
        }
        this.active = model;
      })().finally(() => {
        this.switching = null;
      });
    }
    await this.switching;
    if (this.active !== model) await this.useModel(model);
  }

  private noThink = true;

  /** The streamed answer, and whether it stopped because the context was full. */
  private async chat(payload: Record<string, unknown>): Promise<{ content: string; cut: boolean }> {
    await this.useModel(String(payload.model));
    // Thinking models (such as qwen3-vl) can write thousands of hidden words per
    // image; the maker only needs the JSON answer, so thinking is turned off.
    // A server that rejects the flag is asked again without it.
    let res: Response;
    try {
      res = await this.request("/api/chat", { ...payload, ...(this.noThink ? { think: false } : {}), keep_alive: this.keepAlive, stream: true });
    } catch (e) {
      // only a 400 that complains about the flag itself, not one that merely names a "thinking" model
      const said = e instanceof OllamaError ? e.message.split(String(payload.model)).join("") : "";
      if (!(this.noThink && /HTTP 400/.test(said) && /think/i.test(said))) throw e;
      this.noThink = false;
      res = await this.request("/api/chat", { ...payload, keep_alive: this.keepAlive, stream: true });
    }
    let cut = false;
    const reader = res.body?.getReader();
    if (!reader) return { content: "", cut };
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
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done_reason?: string };
        if (msg.error) throw new OllamaError(`Ollama HTTP 500 on /api/chat: ${msg.error}`);
        content += msg.message?.content ?? "";
        if (msg.done_reason) cut = msg.done_reason === "length";
        this.onToken?.(content.length);
      }
      if (done) break;
    }
    if (buf.trim()) {
      const msg = JSON.parse(buf) as { message?: { content?: string }; error?: string; done_reason?: string };
      if (msg.error) throw new OllamaError(`Ollama HTTP 500 on /api/chat: ${msg.error}`);
      content += msg.message?.content ?? "";
      if (msg.done_reason) cut = msg.done_reason === "length";
    }
    return { content, cut };
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
      let cut: boolean;
      try {
        ({ content, cut } = await this.chat({ model, messages, format: fmt, options }));
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
        // asking again with the cut-off answer attached would only make it longer
        if (cut) throw new AnswerCutOff(`Model ${model} ran out of room: its answer was cut off after ${content.length} characters.`);
        lastErr = e;
        console.warn(`[maker] ${model} gave unreadable JSON (try ${attempt + 1}):`, content.slice(0, 2000));
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
