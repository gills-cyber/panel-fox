import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckRow, Segmented } from "@/components/manga/controls";
import { Sheet, SheetTitle } from "@/components/manga/sheet";
import { BROCHURE_TEMPLATE } from "@/lib/manga/brochure";
import { PAPER_SIZES, paperSpec, type PaperSizeId } from "@/lib/manga/paper";
import { layoutTemplate, TEMPLATES, type GridSpec } from "@/lib/manga/templates";
import { cn } from "@/lib/utils";

export type NewProjectKind = "manga" | "brochure";

export type NewProjectChoice = {
  kind: NewProjectKind;
  templateId: string;
  paperSize: PaperSizeId;
  rtl: boolean;
};

const LAST_KEY = "koma-last-template";

function readLast(): Partial<NewProjectChoice> {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<NewProjectChoice>) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeLast(choice: NewProjectChoice) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(choice));
  } catch {
    /* a convenience, not state */
  }
}

const isBrochure = (spec: GridSpec) => spec.group === "brochure";
const defaultTemplate = (kind: NewProjectKind) =>
  kind === "brochure" ? BROCHURE_TEMPLATE : "blank";

/**
 * The template chooser that opens for a new document, as in Pages: pick a
 * category, a page layout and the paper, then Choose (Return or double-click).
 */
export function NewProjectDialog({
  open,
  initialKind = "manga",
  onClose,
  onChoose,
}: {
  open: boolean;
  initialKind?: NewProjectKind;
  onClose: () => void;
  onChoose: (choice: NewProjectChoice) => void;
}) {
  const [kind, setKind] = useState<NewProjectKind>(initialKind);
  const [templateId, setTemplateId] = useState(defaultTemplate(initialKind));
  const [paperSize, setPaperSize] = useState<PaperSizeId>("a4");
  const [rtl, setRtl] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Each opening starts from the last choice, in the category that was asked for.
  useEffect(() => {
    if (!open) return;
    const last = readLast();
    const k = initialKind;
    setKind(k);
    const lastFits =
      last.kind === k && last.templateId && TEMPLATES.some((t) => t.id === last.templateId);
    setTemplateId(lastFits ? last.templateId! : defaultTemplate(k));
    setPaperSize(last.paperSize && PAPER_SIZES.some((p) => p.id === last.paperSize) ? last.paperSize : "a4");
    setRtl(Boolean(last.rtl));
  }, [open, initialKind]);

  const specs = TEMPLATES.filter((t) => (kind === "brochure" ? isBrochure(t) : !isBrochure(t)));
  const current = specs.some((t) => t.id === templateId) ? templateId : specs[0]!.id;
  const paper = kind === "brochure" ? "letter" : paperSize;
  const aspect = paperSpec(paper);

  function switchKind(next: NewProjectKind) {
    setKind(next);
    setTemplateId(defaultTemplate(next));
  }

  function choose() {
    const choice: NewProjectChoice = { kind, templateId: current, paperSize: paper, rtl: kind === "manga" && rtl };
    writeLast(choice);
    onChoose(choice);
  }

  // The chosen card carries focus so arrows walk the grid and Return chooses.
  useLayoutEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-template="${current}"]`);
    if (el && document.activeElement?.closest("[data-koma-dialog='new-project']")) {
      const focusWasOnCard = document.activeElement?.hasAttribute("data-template");
      if (focusWasOnCard) el.focus({ preventScroll: true });
    }
    el?.scrollIntoView({ block: "nearest" });
  }, [open, current]);

  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      // Return chooses, wherever focus sits in the grid.
      e.preventDefault();
      choose();
      return;
    }
    const cards = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-template]") ?? [])];
    const i = cards.findIndex((c) => c.dataset.template === current);
    if (i < 0 || !cards.length) return;
    const top = cards[0]!.getBoundingClientRect().top;
    const cols = Math.max(1, cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length);
    let next = i;
    if (e.key === "ArrowRight") next = i + 1;
    else if (e.key === "ArrowLeft") next = i - 1;
    else if (e.key === "ArrowDown") next = i + cols;
    else if (e.key === "ArrowUp") next = i - cols;
    else return;
    e.preventDefault();
    const card = cards[Math.max(0, Math.min(cards.length - 1, next))]!;
    setTemplateId(card.dataset.template!);
    card.focus({ preventScroll: true });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      koma="new-project"
      aria-labelledby="new-project-title"
      className="flex max-h-[calc(100dvh-6rem)] max-w-3xl flex-col p-0"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        gridRef.current?.querySelector<HTMLElement>(`[data-template="${current}"]`)?.focus({ preventScroll: true });
      }}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          choose();
        }}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          <SheetTitle asChild>
            <h2 id="new-project-title" className="text-[15px] font-semibold">
              Choose a Template
            </h2>
          </SheetTitle>
          <Segmented
            className="w-56"
            value={kind}
            onChange={(id) => switchKind(id as NewProjectKind)}
            options={[
              { id: "manga", label: "Manga" },
              { id: "brochure", label: "Clinic brochure" },
            ]}
          />
        </div>
        <div className="h-px shrink-0 bg-line" />
        <div
          ref={gridRef}
          role="radiogroup"
          aria-label="Templates"
          data-koma="template-grid"
          onKeyDown={onGridKey}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
        >
          <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5">
            {specs.map((spec, i) => (
              <TemplateCard
                key={`${kind}-${spec.id}`}
                spec={spec}
                index={i}
                aspect={aspect.w / aspect.h}
                active={spec.id === current}
                onSelect={() => setTemplateId(spec.id)}
                onChoose={choose}
              />
            ))}
          </div>
        </div>
        <div className="h-px shrink-0 bg-line" />
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          {kind === "manga" ? (
            <>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-medium text-muted">Paper</span>
                <Segmented
                  className="w-64"
                  value={paperSize}
                  onChange={(id) => setPaperSize(id as PaperSizeId)}
                  options={PAPER_SIZES.map((p) => ({ id: p.id, label: p.label }))}
                />
              </div>
              <CheckRow label="Right to left" checked={rtl} onChange={setRtl} koma="new-rtl" />
            </>
          ) : (
            <span className="text-[12px] text-muted">US Letter · white paper · clinic styling</span>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" data-koma="new-choose">
              Choose
            </Button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

function TemplateCard({
  spec,
  index,
  aspect,
  active,
  onSelect,
  onChoose,
}: {
  spec: GridSpec;
  index: number;
  aspect: number;
  active: boolean;
  onSelect: () => void;
  onChoose: () => void;
}) {
  const panels = layoutTemplate(spec, 7, 3.2, false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      data-template={spec.id}
      data-koma="template-card"
      title={spec.blurb}
      onClick={onSelect}
      onDoubleClick={onChoose}
      style={{ ["--i" as string]: index }}
      className={cn(
        "koma-template-card group flex flex-col gap-2 rounded-[10px] p-2 text-left outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-accent/35",
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-[3px] bg-paper-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.08)] transition-transform duration-[var(--motion-quick)] ease-[var(--ease-out)] group-hover:-translate-y-0.5",
          active && "ring-[3px] ring-accent ring-offset-2 ring-offset-surface",
        )}
        style={{ aspectRatio: String(aspect) }}
      >
        {panels.map((p) => (
          <span
            key={p.id}
            className="absolute bg-[#2a2a2c]"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` }}
          />
        ))}
      </div>
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate text-[12px] font-medium", active ? "text-ink" : "text-ink/85")}>
          {spec.name}
        </span>
        <span className="truncate text-[11px] text-muted">{spec.blurb}</span>
      </span>
    </button>
  );
}
