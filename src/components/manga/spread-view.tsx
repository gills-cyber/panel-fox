import { MangaPage } from "@/components/manga/manga-page";
import { facingSpread, pageLabel } from "@/lib/manga/book";
import { paperSpec } from "@/lib/manga/paper";
import { pageCssWidth, type PageZoom } from "@/lib/manga/zoom";
import { useStudio } from "@/lib/manga/store";
import type { PageState } from "@/lib/manga/types";
import { cn } from "@/lib/utils";

export function SpreadView({
  onPickFile,
  onArmFile,
  zoom = "fit",
}: {
  onPickFile: (panelId: string) => void;
  onArmFile?: (panelId: string) => void;
  zoom?: PageZoom;
}) {
  const pages = useStudio((s) => s.pages);
  const currentPageId = useStudio((s) => s.currentPageId);
  const spread = useStudio((s) => s.spread);
  const rtl = useStudio((s) => s.rtl);
  const coverFirst = useStudio((s) => s.book.coverFirst);
  const paper = useStudio((s) => s.paper);
  const paperSize = useStudio((s) => s.paperSize);
  const spec = paperSpec(paperSize);

  // At a numeric zoom the container hugs the sheets, so a page wider than the
  // stage scrolls from its left edge instead of overflowing both sides.
  const hug = zoom === "fit" ? "w-full max-w-full" : "w-max max-w-none";

  if (!spread) {
    return (
      <div data-koma-zoom-subject="" className={cn("mx-auto flex flex-col items-center", hug)}>
        <MangaPage onPickFile={onPickFile} onArmFile={onArmFile} zoom={zoom} />
        <p
          data-koma="folio"
          className="mt-2.5 text-center text-[11px] tabular-nums text-muted"
        >
          {pageLabel(pages, currentPageId, coverFirst)}
        </p>
      </div>
    );
  }

  const slot = facingSpread(pages, currentPageId, { coverFirst, rtl });

  function sheet(page: PageState | null, side: "left" | "right") {
    const isCurrent = page?.id === currentPageId;
    return (
      <div
        data-koma={side === "left" ? "spread-left" : "spread-right"}
        className={cn(
          "relative min-w-0 flex-1",
          isCurrent ? "z-[2]" : "z-[1] cursor-pointer",
        )}
        onClick={() => {
          if (page && page.id !== currentPageId) {
            useStudio.getState().setCurrentPage(page.id);
          }
        }}
      >
        {page ? (
          <>
            <div className={isCurrent ? undefined : "pointer-events-none"}>
              <MangaPage
                onPickFile={onPickFile}
                onArmFile={onArmFile}
                zoom={zoom}
                pageOverride={isCurrent ? undefined : page}
                readOnly={!isCurrent}
                spreadSlot
              />
            </div>
            <p
              data-koma="folio"
              className="mt-2.5 text-center text-[11px] tabular-nums text-muted"
            >
              {pageLabel(pages, page.id, coverFirst)}
            </p>
          </>
        ) : (
          <>
            <div
              className="paper-sheet mx-auto opacity-[0.42]"
              data-paper={paper}
              data-koma="spread-verso"
              style={{
                width: pageCssWidth(zoom),
                // Sized like the real page: capped only at Fit.
                maxWidth:
                  zoom === "fit"
                    ? `min(calc((100dvh - 7.5rem) * ${spec.w} / ${spec.h} * 0.92), calc((100vw - 20rem) / 2 - 1.25rem))`
                    : undefined,
                aspectRatio: `${spec.w} / ${spec.h}`,
              }}
            />
            <p className="mt-2.5 text-center text-[11px] text-faint">Verso</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      data-koma="spread"
      data-koma-zoom-subject=""
      className={cn("koma-spread mx-auto flex items-start justify-center", hug)}
    >
      {sheet(slot.left, "left")}
      <div className="koma-spine" aria-hidden />
      {sheet(slot.right, "right")}
    </div>
  );
}
