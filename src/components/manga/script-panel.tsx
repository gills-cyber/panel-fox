import { useRef, type ChangeEvent } from "react";
import { ChevronsUpDown, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileToLogoSrc } from "@/lib/manga/image";
import { SCRIPT_KINDS, speakerOf } from "@/lib/manga/script";
import { useStudio } from "@/lib/manga/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ScriptPanel({ compact = false }: { compact?: boolean }) {
  const script = useStudio((s) => s.script);
  const cast = useStudio((s) => s.cast);
  const selectedOverlayId = useStudio((s) => s.selectedOverlayId);
  const portraitRef = useRef<HTMLInputElement>(null);
  const portraitFor = useRef<string | null>(null);

  async function onPortrait(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = portraitFor.current;
    portraitFor.current = null;
    if (!file || !id) return;
    try {
      const src = await fileToLogoSrc(file);
      useStudio.getState().setCastPortrait(id, src);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add portrait");
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", compact ? "px-4 pb-8 pt-2" : "px-4 pb-8 pt-4")} data-koma="script-panel">
      <input
        ref={portraitRef}
        type="file"
        accept="image/*"
        className="koma-file"
        data-koma="cast-portrait-file"
        onChange={onPortrait}
      />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted">Cast</p>
          <button
            type="button"
            data-koma="script-add-cast"
            className="flex h-7 items-center gap-1 rounded-[7px] px-1.5 text-[11px] font-medium text-ink hover:bg-ink/6"
            onClick={() => useStudio.getState().addCast()}
          >
            <UserPlus className="size-3.5" />
            Add
          </button>
        </div>
        {cast.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Add Aiko, Ren, whoever speaks. Stamp their portrait onto a panel.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {cast.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-2 rounded-[10px] bg-ink/4 px-2 py-1.5"
                data-koma="cast-row"
              >
                <button
                  type="button"
                  title="Set portrait"
                  aria-label={`Portrait for ${member.name}`}
                  className="size-9 shrink-0 overflow-hidden rounded-full bg-ink/10 ring-1 ring-line"
                  style={{ boxShadow: `inset 0 0 0 2px ${member.color}` }}
                  onClick={() => {
                    portraitFor.current = member.id;
                    portraitRef.current?.click();
                  }}
                >
                  {member.portrait ? (
                    <img src={member.portrait} alt="" className="size-full object-cover" />
                  ) : (
                    <span
                      className="flex size-full items-center justify-center text-[11px] font-semibold text-paper"
                      style={{ background: member.color }}
                    >
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </button>
                <input
                  value={member.name}
                  aria-label="Character name"
                  onChange={(e) =>
                    useStudio.getState().renameCast(member.id, e.target.value)
                  }
                  className="koma-field h-7 min-w-0 flex-1"
                />
                {member.portrait ? (
                  <button
                    type="button"
                    data-koma="cast-stamp"
                    className="h-7 rounded-[7px] px-2 text-[11px] font-medium hover:bg-ink/8"
                    onClick={() => useStudio.getState().stampCast(member.id)}
                  >
                    Stamp
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${member.name}`}
                  className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-ink/8 hover:text-ink"
                  onClick={() => useStudio.getState().removeCast(member.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted">Script</p>
          <button
            type="button"
            data-koma="script-add-line"
            className="flex h-7 items-center gap-1 rounded-[7px] px-1.5 text-[11px] font-medium text-ink hover:bg-ink/6"
            onClick={() => useStudio.getState().addScriptLine()}
          >
            <Plus className="size-3.5" />
            Line
          </button>
        </div>
        {script.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Write the page first. Place a line to drop its balloon on the selected panel.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {script.map((line, i) => {
              const speaker = speakerOf(cast, line.speakerId);
              const active = line.overlayId === selectedOverlayId;
              return (
                <li
                  key={line.id}
                  data-koma="script-line"
                  data-line-id={line.id}
                  className={cn(
                    "rounded-[12px] p-2 ring-1 ring-transparent",
                    active ? "bg-ink/8 ring-ink/10" : "bg-ink/4",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-paper"
                      style={{ background: speaker?.color ?? "#6e6e73" }}
                    >
                      {i + 1}
                    </span>
                    <span className="koma-popup min-w-0 flex-1">
                      <select
                        aria-label="Speaker"
                        value={line.speakerId ?? ""}
                        onChange={(e) =>
                          useStudio.getState().updateScriptLine(line.id, {
                            speakerId: e.target.value || null,
                          })
                        }
                        className="koma-field h-7 w-full text-[12px] outline-none"
                      >
                        <option value="">Narrator</option>
                        {cast.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden className="koma-popup-badge">
                        <ChevronsUpDown className="size-3" strokeWidth={2.5} />
                      </span>
                    </span>
                    <span className="koma-popup w-[5.9rem] shrink-0">
                      <select
                        aria-label="Line type"
                        value={line.kind}
                        onChange={(e) =>
                          useStudio.getState().updateScriptLine(line.id, {
                            kind: e.target.value as (typeof SCRIPT_KINDS)[number]["id"],
                          })
                        }
                        className="koma-field h-7 w-full text-[12px] outline-none"
                      >
                        {SCRIPT_KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden className="koma-popup-badge">
                        <ChevronsUpDown className="size-3" strokeWidth={2.5} />
                      </span>
                    </span>
                  </div>
                  <textarea
                    value={line.text}
                    aria-label={`Line ${i + 1}`}
                    placeholder="What they say…"
                    rows={2}
                    onChange={(e) =>
                      useStudio.getState().updateScriptLine(line.id, {
                        text: e.target.value,
                      })
                    }
                    onFocus={() => useStudio.getState().focusScriptLine(line.id)}
                    className="koma-field mb-1.5 w-full resize-none leading-snug outline-none"
                  />
                  <div className="flex items-center justify-between gap-1">
                    <Button
                      variant={line.overlayId ? "muted" : "outline"}
                      size="sm"
                      data-koma="script-place"
                      className="h-7 rounded-[8px] px-2.5 text-[11px]"
                      onClick={() => useStudio.getState().placeScriptLine(line.id)}
                    >
                      {line.overlayId ? "Select balloon" : "Place on page"}
                    </Button>
                    <button
                      type="button"
                      aria-label="Remove line"
                      className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-ink/8 hover:text-ink"
                      onClick={() => useStudio.getState().removeScriptLine(line.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
