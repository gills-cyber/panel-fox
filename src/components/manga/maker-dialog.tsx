import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Images,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openProjectDocument, type ProjectDoc } from "@/lib/manga/project";
import { useStudio } from "@/lib/manga/store";
import {
  DEFAULT_ADVANCED,
  friendlyError,
  imagesFromDrop,
  imagesFromPicker,
  loadSettings,
  newCharacter,
  ollamaStatus,
  photoFromFile,
  saveSettings,
  startChapter,
  timingSummary,
  type ChosenImages,
  type MakerCharacter,
  type MakerSettings,
  type OllamaStatus,
  type Progress,
  type RunHandle,
} from "@/lib/maker/app";
import { PALETTE } from "@/lib/maker/config";
import { isLocalHost, normalizeHost } from "@/lib/maker/ollama";

// The chosen images last for the session, so closing the window keeps them.
let rememberedImages: ChosenImages | null = null;

const STEPS: { id: Progress["step"][]; label: string }[] = [
  { id: ["starting", "looking"], label: "Looking at your images" },
  { id: ["ordering"], label: "Finding the story" },
  { id: ["layout"], label: "Laying out the pages" },
  { id: ["writing"], label: "Writing the dialogue" },
  { id: ["saving"], label: "Placing speech bubbles" },
];

function stepIndex(step: Progress["step"]) {
  if (step === "done") return STEPS.length;
  return Math.max(0, STEPS.findIndex((s) => s.id.includes(step)));
}

/** Inputs keep 16px on touch screens (no zoom on focus) and use the Mac's 13px elsewhere. */
const FIELD =
  "h-8 w-full min-w-0 rounded-[7px] border border-line bg-paper-white [[data-theme=dark]_&]:bg-white/[0.07] px-2.5 text-[16px] text-ink outline-none transition-shadow placeholder:text-faint focus:border-accent/60 focus:ring-[3px] focus:ring-accent/25 md:!text-[13px]";

function Section({ title, caption, children, aside }: { title: string; caption?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-end justify-between gap-2 px-1">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface/70">{children}</div>
      {caption ? <p className="px-1 text-[11px] leading-snug text-muted">{caption}</p> : null}
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-11 items-center gap-3 px-3 py-2 [&+&]:border-t [&+&]:border-line", className)}>{children}</div>;
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center overflow-hidden rounded-[7px] border border-line bg-paper-white [[data-theme=dark]_&]:bg-white/[0.07]">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} className="px-2 py-1 text-ink-soft hover:bg-ink/5 disabled:opacity-40" onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="size-3" />
      </button>
      <span className="w-7 text-center text-[13px] tabular-nums">{value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} className="px-2 py-1 text-ink-soft hover:bg-ink/5 disabled:opacity-40" onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="size-3" />
      </button>
    </div>
  );
}

function Switch({ checked, onChange, label, koma }: { checked: boolean; onChange: (v: boolean) => void; label: string; koma?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-koma={koma}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-ink/15",
      )}
    >
      <span
        className={cn(
          "absolute left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-[var(--ease-spring)]",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function CheckBox({ checked, onChange, children, koma }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; koma?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-koma={koma}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-left text-[13px] text-ink"
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          checked ? "border-accent bg-accent text-white" : "border-ink/25 bg-paper-white [[data-theme=dark]_&]:bg-white/[0.07]",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      {children}
    </button>
  );
}

function StatusPill({ status, testMode, onClick }: { status: OllamaStatus | null; testMode: boolean; onClick: () => void }) {
  let tone = "bg-faint";
  let text = "Checking…";
  let title = "";
  if (testMode) {
    tone = "bg-amber-400";
    text = "Test run";
  } else if (status) {
    if (status.badAddress) {
      tone = "bg-red-500";
      text = "Check the address";
      title = "The Ollama address in Advanced isn’t a web address";
    } else if (!status.running) {
      tone = "bg-red-500";
      text = "Can’t reach Ollama";
      title = "Show how to connect";
    } else if (status.missing.length) {
      tone = "bg-amber-500";
      text = "Models missing";
      title = status.missing.join(", ");
    } else {
      tone = "bg-green-500";
      text = "Ready";
    }
  }
  return (
    <button
      type="button"
      data-koma="maker-status"
      title={title || "Show Ollama settings"}
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink/5 px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:bg-ink/10"
    >
      <span className={cn("size-2 rounded-full", tone)} />
      {text}
    </button>
  );
}

function Avatar({ c, index, onPick }: { c: MakerCharacter; index: number; onPick: () => void }) {
  const initial = c.name.trim().slice(0, 1).toUpperCase();
  return (
    <button
      type="button"
      onClick={onPick}
      title={c.photo ? "Change photo" : "Add a photo"}
      aria-label={c.photo ? "Change photo" : "Add a photo"}
      className="group relative size-11 shrink-0 overflow-hidden rounded-full ring-1 ring-line transition-transform active:scale-95"
      style={{ background: c.photo ? undefined : `${PALETTE[index % PALETTE.length]}22` }}
    >
      {c.photo ? (
        <img src={c.photo.dataUrl} alt="" className="size-full object-cover" />
      ) : initial ? (
        <span className="text-[17px] font-semibold" style={{ color: PALETTE[index % PALETTE.length] }}>
          {initial}
        </span>
      ) : (
        <UserRound className="mx-auto size-5 text-muted" />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-black/45 py-px text-center text-[9px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {c.photo ? "Change" : "Photo"}
      </span>
    </button>
  );
}

function Thumbs({ files }: { files: File[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = files.slice(0, 10).map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="flex gap-1.5 overflow-hidden px-3 pb-3">
      {urls.map((u) => (
        <img key={u} src={u} alt="" className="h-14 w-10 shrink-0 rounded-[5px] object-cover ring-1 ring-line" />
      ))}
      {files.length > urls.length ? (
        <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded-[5px] bg-ink/5 text-[11px] text-muted">
          +{files.length - urls.length}
        </span>
      ) : null}
    </div>
  );
}

export function MakerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<MakerSettings | null>(null);
  const [chosen, setChosen] = useState<ChosenImages | null>(rememberedImages);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [started, setStarted] = useState(0);
  // When the first image finished, so model loading is not counted in the time-left estimate.
  const [firstImage, setFirstImage] = useState<{ at: number; done: number } | null>(null);
  const [now, setNow] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const runRef = useRef<RunHandle | null>(null);
  const stoppedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoFor = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = progress !== null;

  useEffect(() => {
    if (!open) return;
    setError("");
    let alive = true;
    void loadSettings().then((s) => alive && setSettings(s));
    const t = window.setTimeout(() => rootRef.current?.focus(), 30);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open]);

  // when Create, Stop or an error swaps the content, keep keyboard focus in this window
  useEffect(() => {
    const root = rootRef.current;
    if (open && root && !root.contains(document.activeElement)) root.focus();
  }, [open, running, finishing, error, settings]);

  // the folder picker: webkitdirectory is not a React prop
  useEffect(() => {
    const el = folderRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, [open]);

  const refreshStatus = useCallback(async (s: MakerSettings) => {
    setStatus(null);
    setStatus(await ollamaStatus(s.advanced));
  }, []);

  const host = settings?.advanced.host;
  const models = settings ? `${settings.advanced.visionModel}|${settings.advanced.dialogueModel}` : "";
  useEffect(() => {
    if (!open || !settings) return;
    const t = window.setTimeout(() => void refreshStatus(settings), 300);
    return () => window.clearTimeout(t);
    // only the address and the models change what Ollama reports
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host, models, refreshStatus]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  function update(fn: (s: MakerSettings) => MakerSettings) {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveSettings(next), 400);
      return next;
    });
  }

  function setCharacter(id: string, patch: Partial<MakerCharacter>) {
    update((s) => ({
      ...s,
      characters: s.characters.map((c) => {
        if (c.id === id) return { ...c, ...patch };
        // only one reader at a time
        return patch.pov ? { ...c, pov: false } : c;
      }),
    }));
  }

  function choose(next: ChosenImages | null) {
    if (!next) return;
    if (!next.files.length) {
      setError("That folder has no images in it (PNG, JPG, WEBP, GIF or BMP).");
      return;
    }
    setError("");
    rememberedImages = next;
    setChosen(next);
  }

  function close() {
    if (running) return;
    onClose();
  }

  async function create() {
    if (!settings || running) return;
    setError("");
    if (!chosen?.files.length) return setError("Choose a folder of images first.");
    if (!settings.characters.some((c) => c.name.trim())) return setError("Add at least one character.");
    if (!settings.adultsOk) return setError("Please confirm that all characters are adults.");
    if (!settings.advanced.testMode && !normalizeHost(settings.advanced.host)) {
      setAdvanced(true);
      return setError("Enter an Ollama address like http://localhost:11434 in Advanced.");
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void saveSettings(settings);
    }
    stoppedRef.current = false;
    setStarted(Date.now());
    setNow(Date.now());
    setProgress({ step: "starting", detail: "", fraction: 0.02, notes: [], timings: [] });
    setFirstImage(null);
    let firstSeen = false;
    const onProgress = (p: Progress) => {
      const m = p.step === "looking" ? /^(\d+) of \d+ images done$/.exec(p.detail) : null;
      if (!firstSeen && m && Number(m[1]) > (p.reused ?? 0)) {
        firstSeen = true;
        setFirstImage({ at: Date.now(), done: Number(m[1]) });
      }
      setProgress(p);
    };
    const handle = startChapter({ chosen, settings, onProgress });
    runRef.current = handle;
    try {
      const { file, notes, timings } = await handle.done;
      if (stoppedRef.current) return;
      setFinishing(true);
      const record = await openProjectDocument(file as unknown as { name: string; doc: ProjectDoc }, chosen.folderName);
      useStudio.getState().setReadMode(false);
      const pages = (file.doc.pages ?? []).length;
      toast.success(`“${record.name}” is ready · ${pages} page${pages === 1 ? "" : "s"}`, {
        description: [notes.length ? notes.join(" ") : "Every panel and bubble can be edited.", timingSummary(timings)].filter(Boolean).join(" "),
        duration: 9000,
      });
      setProgress(null);
      setFinishing(false);
      onClose();
    } catch (e) {
      setProgress(null);
      setFinishing(false);
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(friendlyError(e));
    } finally {
      runRef.current = null;
    }
  }

  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !root.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  const s = settings;
  const step = progress ? stepIndex(progress.step) : 0;
  const elapsed = Math.max(0, Math.round((now - started) / 1000));
  const createHint = !chosen?.files.length
    ? "Choose images to begin"
    : !s?.characters.some((c) => c.name.trim())
      ? "Name a character"
      : !s?.adultsOk
        ? "Confirm 18+ to continue"
        : "";
  const canCreate = Boolean(s && chosen?.files.length && s.characters.some((c) => c.name.trim()) && s.adultsOk);
  const visionFirst = (status?.models ?? []).slice().sort((a, b) => Number(b.capabilities.includes("vision")) - Number(a.capabilities.includes("vision")));

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-0 sm:p-6">
      <button type="button" className="koma-scrim absolute inset-0" aria-label="Close" onClick={close} />
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="maker-title"
        data-koma-dialog="maker"
        onKeyDown={(e) => {
          // the editor's shortcuts stay off while this window is open
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Tab") {
            trapTab(e);
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing && !running && canCreate) {
            const t = e.target as HTMLElement;
            if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") {
              e.preventDefault();
              void create();
            }
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!running) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          if (running) return;
          void imagesFromDrop(e.dataTransfer).then(choose, (err) => setError(friendlyError(err)));
        }}
        className="koma-glass-surface relative flex h-full max-h-[100dvh] w-full flex-col outline-none sm:h-auto sm:max-h-[90dvh] sm:max-w-[600px] sm:rounded-[18px] sm:shadow-float"
      >
        {/* title bar */}
        <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#5e9dff] to-[#0062d6] text-white shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.35),0_2px_6px_rgb(0_80_200/0.3)]">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-[12rem] flex-1">
            <h2 id="maker-title" className="text-[15px] font-semibold leading-tight text-ink">
              New Chapter with AI
            </h2>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              Turn a folder of your images into a finished manga chapter.{" "}
              {!s || isLocalHost(s.advanced.host) ? "Everything stays on this computer." : "Images are sent to the Ollama address you set."}
            </p>
          </div>
          {s ? <StatusPill status={status} testMode={s.advanced.testMode} onClick={() => !running && setAdvanced(true)} /> : null}
        </div>

        {!s ? (
          <div className="flex h-40 items-center justify-center text-[13px] text-muted">Loading…</div>
        ) : running && progress ? (
          /* progress */
          <div className="flex flex-1 flex-col items-center px-6 py-8" data-koma="maker-progress">
            <ol className="w-full max-w-xs space-y-3">
              {STEPS.map((st, i) => {
                const done = i < step;
                const now_ = i === step;
                return (
                  <li key={st.label} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
                        done ? "bg-accent text-white" : now_ ? "ring-2 ring-accent" : "ring-1 ring-ink/20",
                      )}
                    >
                      {done ? (
                        <Check className="size-3" strokeWidth={3} />
                      ) : now_ ? (
                        <span className="size-2.5 animate-pulse rounded-full bg-accent" />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-[13px]", now_ ? "font-semibold text-ink" : done ? "text-ink" : "text-muted")}>
                        {st.label}
                      </span>
                      {now_ && progress.detail ? <span className="block text-[11px] text-muted">{progress.detail}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-7 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]"
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted">
              {(() => {
                const m = progress.step === "looking" ? /^(\d+) of (\d+) images done$/.exec(progress.detail) : null;
                const done = m ? Number(m[1]) : 0;
                const total = m ? Number(m[2]) : 0;
                const sofar = elapsed < 60 ? "" : ` ${Math.floor(elapsed / 60)} min so far.`;
                const fresh = done - (progress.reused ?? 0);
                if (fresh > 0 && total > done) {
                  const each =
                    firstImage && done > firstImage.done
                      ? (now - firstImage.at) / 1000 / (done - firstImage.done)
                      : elapsed / fresh;
                  const left = Math.round((each * (total - done)) / 60);
                  return `Working…${sofar} About ${left < 1 ? "a minute" : `${left} min`} left for the images.`;
                }
                return elapsed < 60 ? "Working… big models can take a while." : `Working…${sofar}`;
              })()}
            </p>
            <p className="mt-1 text-[11px] text-muted">You can keep this window open and wait; your current manga is saved first.</p>
          </div>
        ) : (
          /* form */
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Section
              title="Images"
              caption={chosen ? undefined : "Any folder works. You don’t need to rename anything."}
            >
              {chosen ? (
                <div data-koma="maker-images">
                  <Row>
                    <Folder className="size-8 shrink-0 fill-accent/80 text-accent/80" strokeWidth={1.2} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{chosen.folderName}</p>
                      <p className="text-[11px] text-muted">
                        {chosen.files.length} image{chosen.files.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => folderRef.current?.click()}>
                      Change…
                    </Button>
                  </Row>
                  <Thumbs files={chosen.files} />
                </div>
              ) : (
                <div
                  className={cn(
                    "m-2 flex flex-col items-center gap-2 rounded-[8px] border-[1.5px] border-dashed px-4 py-6 text-center transition-colors",
                    dragging ? "border-accent bg-accent/8" : "border-ink/15",
                  )}
                >
                  <Images className="size-8 text-muted" strokeWidth={1.4} />
                  <p className="text-[13px] text-ink">Drop a folder of images here</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button type="button" size="sm" data-koma="maker-choose-folder" onClick={() => folderRef.current?.click()}>
                      Choose Folder…
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => filesRef.current?.click()}>
                      Choose Images…
                    </Button>
                  </div>
                </div>
              )}
            </Section>

            <Section
              title="Characters"
              caption="Who appears in your images. A photo helps recognise them. Mark one as the reader to have the others speak to “you”."
            >
              {s.characters.map((c, i) => (
                <Row key={c.id} className="items-start py-2.5">
                  <Avatar
                    c={c}
                    index={i}
                    onPick={() => {
                      photoFor.current = c.id;
                      photoRef.current?.click();
                    }}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      value={c.name}
                      placeholder="Name"
                      aria-label="Character name"
                      data-koma="maker-char-name"
                      onChange={(e) => setCharacter(c.id, { name: e.target.value })}
                      className={cn(FIELD, "font-medium")}
                    />
                    <input
                      value={c.personality}
                      placeholder="Personality, in a few words (confident, teasing, blunt)"
                      aria-label="Personality"
                      onChange={(e) => setCharacter(c.id, { personality: e.target.value })}
                      className={FIELD}
                    />
                    <div className="flex items-center justify-between pt-0.5">
                      <CheckBox checked={c.pov} onChange={(v) => setCharacter(c.id, { pov: v })}>
                        <span className="text-[12px] text-ink-soft">This is the reader (POV)</span>
                      </CheckBox>
                      {c.photo ? (
                        <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={() => setCharacter(c.id, { photo: null })}>
                          Remove photo
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${c.name || "character"}`}
                    title="Remove"
                    onClick={() =>
                      update((st) => {
                        const rest = st.characters.filter((x) => x.id !== c.id);
                        return { ...st, characters: rest.length ? rest : [newCharacter()] };
                      })
                    }
                    className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink-soft transition-colors hover:bg-red-500 hover:text-white"
                  >
                    <Minus className="size-3" strokeWidth={3} />
                  </button>
                </Row>
              ))}
              <Row className="min-h-9 py-1.5">
                <button
                  type="button"
                  data-koma="maker-add-char"
                  onClick={() => update((st) => ({ ...st, characters: [...st.characters, newCharacter()] }))}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:opacity-80"
                >
                  <Plus className="size-4" />
                  Add Character
                </button>
              </Row>
            </Section>

            <Section title="Story" caption="Optional. Leave these blank and the story is found in your images.">
              <Row>
                <label className="w-28 shrink-0 text-[13px] text-ink" htmlFor="maker-title-in">
                  Title
                </label>
                <input
                  id="maker-title-in"
                  value={s.chapterName}
                  placeholder="Chapter 1"
                  onChange={(e) => update((st) => ({ ...st, chapterName: e.target.value }))}
                  className={FIELD}
                />
              </Row>
              <Row>
                <label className="w-28 shrink-0 text-[13px] text-ink" htmlFor="maker-premise">
                  What it’s about
                </label>
                <input
                  id="maker-premise"
                  value={s.premise}
                  placeholder="Two coworkers stuck late at the office…"
                  onChange={(e) => update((st) => ({ ...st, premise: e.target.value }))}
                  className={FIELD}
                />
              </Row>
              <Row>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">Use every image</p>
                  <p className="text-[11px] leading-snug text-muted">
                    When off, the story is sketched first and only the images that fit it are kept.
                  </p>
                </div>
                <Switch label="Use every image" checked={s.useAllImages} onChange={(v) => update((st) => ({ ...st, useAllImages: v }))} />
              </Row>
            </Section>

            {/* advanced */}
            <div>
              <button
                type="button"
                aria-expanded={advanced}
                data-koma="maker-advanced"
                onClick={() => setAdvanced((v) => !v)}
                className="flex items-center gap-1 px-1 text-[13px] font-medium text-ink-soft hover:text-ink"
              >
                {advanced ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                Advanced
              </button>
              {advanced ? (
                <div className="mt-2 space-y-4">
                  <Section
                    title="Models"
                    aside={
                      <button type="button" className="text-[12px] text-accent hover:opacity-80" onClick={() => void refreshStatus(s)}>
                        Refresh
                      </button>
                    }
                    caption={
                      status && !status.running ? (
                        <>
                          Manga Maker uses Ollama on this computer. Install it from ollama.com and open it. In a web browser, Ollama
                          must also allow this site (set OLLAMA_ORIGINS); the Panel Fox desktop app needs nothing extra.
                        </>
                      ) : status?.missing.length ? (
                        <>Install a missing model in Terminal with: ollama pull {status.missing[0]}</>
                      ) : undefined
                    }
                  >
                    {(
                      [
                        ["visionModel", "Vision model", "Looks at each image"],
                        ["dialogueModel", "Dialogue model", "Writes the script"],
                      ] as const
                    ).map(([key, label, hint]) => {
                      const value = s.advanced[key];
                      const names = visionFirst.map((m) => m.name);
                      return (
                        <Row key={key}>
                          <div className="w-28 shrink-0">
                            <p className="text-[13px] text-ink">{label}</p>
                            <p className="text-[11px] text-muted">{hint}</p>
                          </div>
                          <div className="relative min-w-0 flex-1">
                            <select
                              value={value}
                              aria-label={label}
                              onChange={(e) => update((st) => ({ ...st, advanced: { ...st.advanced, [key]: e.target.value } }))}
                              className={cn(FIELD, "pr-7")}
                            >
                              {!names.includes(value) ? <option value={value}>{value} (not installed)</option> : null}
                              {visionFirst.map((m) => (
                                <option key={m.name} value={m.name}>
                                  {m.name}
                                  {m.params ? ` · ${m.params}` : ""}
                                  {key === "visionModel" && m.capabilities.includes("vision") ? " · sees images" : ""}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                          </div>
                        </Row>
                      );
                    })}
                    <Row>
                      <label className="w-28 shrink-0 text-[13px] text-ink" htmlFor="maker-host">
                        Ollama address
                      </label>
                      <input
                        id="maker-host"
                        value={s.advanced.host}
                        spellCheck={false}
                        onChange={(e) => update((st) => ({ ...st, advanced: { ...st.advanced, host: e.target.value } }))}
                        className={FIELD}
                      />
                    </Row>
                  </Section>

                  <Section title="Chapter">
                    <Row>
                      <label className="w-28 shrink-0 text-[13px] text-ink" htmlFor="maker-lang">
                        Language
                      </label>
                      <input
                        id="maker-lang"
                        value={s.advanced.language}
                        onChange={(e) => update((st) => ({ ...st, advanced: { ...st.advanced, language: e.target.value } }))}
                        className={FIELD}
                      />
                    </Row>
                    <Row>
                      <label className="w-28 shrink-0 text-[13px] text-ink" htmlFor="maker-temp">
                        Creativity
                      </label>
                      <input
                        id="maker-temp"
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={s.advanced.temperature}
                        onChange={(e) =>
                          update((st) => ({ ...st, advanced: { ...st.advanced, temperature: parseFloat(e.target.value) } }))
                        }
                        className="min-w-0 flex-1 accent-[var(--color-accent)]"
                      />
                      <span className="w-9 text-right text-[12px] tabular-nums text-muted">{s.advanced.temperature.toFixed(2)}</span>
                    </Row>
                    <Row>
                      <p className="flex-1 text-[13px] text-ink">Pages written at a time</p>
                      <Stepper
                        label="pages"
                        value={s.advanced.pagesPerCall}
                        min={1}
                        max={10}
                        onChange={(v) => update((st) => ({ ...st, advanced: { ...st.advanced, pagesPerCall: v } }))}
                      />
                    </Row>
                    <Row>
                      <div className="flex-1">
                        <p className="text-[13px] text-ink">Images looked at together</p>
                        <p className="text-[11px] leading-snug text-muted">Faster on a big graphics card when Ollama allows it (OLLAMA_NUM_PARALLEL). Use 1 if Ollama runs out of memory.</p>
                      </div>
                      <Stepper
                        label="images"
                        value={s.advanced.parallel}
                        min={1}
                        max={8}
                        onChange={(v) => update((st) => ({ ...st, advanced: { ...st.advanced, parallel: v } }))}
                      />
                    </Row>
                    {(
                      [
                        ["rtl", "Read right to left (manga style)"],
                        ["keepOrder", "Keep the folder’s file order"],
                        ["testMode", "Test run (no models, placeholder text)"],
                      ] as const
                    ).map(([key, label]) => (
                      <Row key={key}>
                        <p className="flex-1 text-[13px] text-ink">{label}</p>
                        <Switch
                          label={label}
                          koma={`maker-${key}`}
                          checked={s.advanced[key]}
                          onChange={(v) => update((st) => ({ ...st, advanced: { ...st.advanced, [key]: v } }))}
                        />
                      </Row>
                    ))}
                  </Section>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-1 text-[12px] text-accent hover:opacity-80"
                    onClick={() => update((st) => ({ ...st, advanced: { ...DEFAULT_ADVANCED } }))}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore Defaults
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* footer */}
        {s ? (
          <div className="border-t border-line px-5 py-3">
            {error ? (
              <p role="alert" data-koma="maker-error" className="mb-2.5 whitespace-pre-line rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] leading-snug text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              {running && finishing ? (
                <p className="text-[12px] text-muted">Opening your chapter…</p>
              ) : running ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-koma="maker-stop"
                  onClick={() => {
                    stoppedRef.current = true;
                    runRef.current?.stop();
                    const seen = progress ? /^(\d+) of (\d+) images done$/.exec(progress.detail) : null;
                    const lookedAt = seen ? Number(seen[1]) : 0;
                    const pastImages = progress ? stepIndex(progress.step) > stepIndex("looking") : false;
                    setProgress(null);
                    toast.message(
                      s?.advanced.testMode || (!pastImages && !lookedAt)
                        ? "Stopped. Nothing was changed."
                        : pastImages
                          ? "Stopped. The images it looked at are kept, so Create will go straight to writing."
                          : `Stopped. The ${lookedAt === 1 ? "image" : `${lookedAt} images`} it looked at ${lookedAt === 1 ? "is" : "are"} kept, so Create will carry on from there.`,
                    );
                  }}
                >
                  Stop
                </Button>
              ) : (
                <>
                  <div className="mr-auto">
                    <CheckBox koma="maker-adults" checked={s.adultsOk} onChange={(v) => update((st) => ({ ...st, adultsOk: v }))}>
                      All characters are adults (18+)
                    </CheckBox>
                  </div>
                  {!canCreate && createHint ? (
                    <span className="hidden text-[11px] text-muted sm:inline" data-koma="maker-hint">{createHint}</span>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" data-koma="maker-create" disabled={!canCreate} onClick={() => void create()}>
                    Create Chapter
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <input
          ref={folderRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-koma="maker-folder-input"
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) choose(imagesFromPicker(list));
            e.target.value = "";
          }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-koma="maker-files-input"
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) choose({ ...imagesFromPicker(list), folderName: "Untitled Chapter" });
            e.target.value = "";
          }}
        />
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            const id = photoFor.current;
            if (!f || !id) return;
            void photoFromFile(f).then(
              (photo) => setCharacter(id, { photo }),
              () => setError("That photo could not be opened."),
            );
          }}
        />
      </div>
    </div>
  );
}
