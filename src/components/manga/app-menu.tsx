import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isApplePlatform, shiftSymbol } from "@/lib/manga/hotkeys";
import { useStudio } from "@/lib/manga/store";
import { insertTitle } from "@/lib/manga/actions";
import { pageOverlays, isDialogue } from "@/lib/manga/lettering";

type MenuId = "file" | "edit" | "insert" | "arrange" | "view" | null;

function useShortcutGlyphs() {
  const [g, setG] = useState({ mod: "Ctrl", alt: "Alt" });
  useEffect(() => {
    const apple = isApplePlatform();
    setG({ mod: apple ? "⌘" : "Ctrl", alt: apple ? "⌥" : "Alt" });
  }, []);
  return g;
}

function Shortcut({ keys }: { keys: string }) {
  return <span className="ml-8 text-[11px] tabular-nums text-muted">{keys}</span>;
}

function Item({
  label,
  keys,
  disabled,
  onClick,
  href,
  download,
}: {
  label: string;
  keys?: string;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  download?: string;
}) {
  const className =
    "flex h-7 w-full items-center justify-between rounded-[7px] px-2.5 text-left text-[13px] text-ink disabled:opacity-40 hover:bg-ink/8";
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target="_blank"
        rel="noopener"
        className={className}
        onClick={onClick}
      >
        {label}
        {keys ? <Shortcut keys={keys} /> : <span />}
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {label}
      {keys ? <Shortcut keys={keys} /> : <span />}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-line" />;
}

export function AppMenu({
  thumbs,
  onThumbs,
  onExport,
  onImport,
  onSave,
  onSaveAs,
  onOpen,
  onNew,
  onNewBrochure,
  onMakeChapter,
  onDownloadProject,
  onScript,
  onRead,
  spread,
  onSpread,
  theme,
  onTheme,
  onZoomIn,
  onZoomOut,
  onZoomFit,
}: {
  thumbs: boolean;
  onThumbs: () => void;
  onExport: () => void;
  onImport: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onNew: () => void;
  onNewBrochure: () => void;
  onMakeChapter: () => void;
  onDownloadProject: () => void;
  onScript: () => void;
  onRead: () => void;
  spread: boolean;
  onSpread: () => void;
  theme: "light" | "dark";
  onTheme: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}) {
  const [open, setOpen] = useState<MenuId>(null);
  const past = useStudio((s) => s.past.length);
  const future = useStudio((s) => s.future.length);
  const overlayId = useStudio((s) => s.selectedOverlayId);
  const page = useStudio((s) => s.currentPage());
  const overlays = pageOverlays(page);
  const overlayIndex = overlays.findIndex((o) => o.id === overlayId);
  const selectedOverlay = overlayId
    ? overlays.find((o) => o.id === overlayId)
    : undefined;
  const snapEdges = useStudio((s) => s.snapEdges);
  const canFlipTail = Boolean(
    selectedOverlay && isDialogue(selectedOverlay.kind) && !selectedOverlay.locked,
  );
  const { mod: modSymbol, alt: altSymbol } = useShortcutGlyphs();

  useEffect(() => {
    function close(e: PointerEvent) {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-koma-menubar]")) return;
      setOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function run(fn: () => void) {
    fn();
    setOpen(null);
  }

  return (
    <div
      data-koma-menubar
      className="koma-glass relative z-50 hidden h-[1.75rem] shrink-0 items-center gap-0 border-b border-line/70 px-1.5 text-[13px] text-ink md:flex"
    >
      <MenuBtn
        label="File"
        open={open === "file"}
        onOpen={() => setOpen((o) => (o === "file" ? null : "file"))}
      >
        <Item
          label="New Project"
          onClick={() => run(onNew)}
        />
        <Item
          label="New Brochure"
          onClick={() => run(onNewBrochure)}
        />
        <Item
          label="New Chapter from Images…"
          onClick={() => run(onMakeChapter)}
        />
        <Item
          label="Projects…"
          keys={`${modSymbol}O`}
          onClick={() => run(onOpen)}
        />
        <Divider />
        <Item
          label="Save"
          keys={`${modSymbol}S`}
          onClick={() => run(onSave)}
        />
        <Item
          label="Save a Copy…"
          keys={`${modSymbol}${shiftSymbol}S`}
          onClick={() => run(onSaveAs)}
        />
        <Item
          label="Download Project File"
          onClick={() => run(onDownloadProject)}
        />
        <Divider />
        <Item label="New Page" onClick={() => run(() => useStudio.getState().addPage())} />
        <Item
          label="Duplicate Page"
          keys={`${modSymbol}${shiftSymbol}D`}
          onClick={() => run(() => useStudio.getState().duplicatePage())}
        />
        <Divider />
        <Item label="Import Photos or PDF…" onClick={() => run(onImport)} />
        <Divider />
        <Item
          label="Export…"
          keys={`${modSymbol}E`}
          onClick={() => run(onExport)}
        />
      </MenuBtn>
      <MenuBtn
        label="Edit"
        open={open === "edit"}
        onOpen={() => setOpen((o) => (o === "edit" ? null : "edit"))}
      >
        <Item
          label="Undo"
          keys={`${modSymbol}Z`}
          disabled={!past}
          onClick={() => run(() => useStudio.getState().undo())}
        />
        <Item
          label="Redo"
          keys={`${modSymbol}${shiftSymbol}Z`}
          disabled={!future}
          onClick={() => run(() => useStudio.getState().redo())}
        />
        <Divider />
        <Item
          label="Duplicate"
          keys={`${modSymbol}D`}
          onClick={() => run(() => useStudio.getState().duplicateOverlay())}
        />
        <Item
          label="Bold"
          keys={`${modSymbol}B`}
          disabled={!overlayId}
          onClick={() =>
            run(() => {
              if (!overlayId) return;
              const o = useStudio.getState().currentPage().overlays.find((x) => x.id === overlayId);
              if (o) useStudio.getState().updateOverlay(overlayId, { bold: !o.bold });
            })
          }
        />
        <Item
          label="Italic"
          keys={`${modSymbol}I`}
          disabled={!overlayId}
          onClick={() =>
            run(() => {
              if (!overlayId) return;
              const o = useStudio.getState().currentPage().overlays.find((x) => x.id === overlayId);
              if (o) useStudio.getState().updateOverlay(overlayId, { italic: !o.italic });
            })
          }
        />
        <Item
          label="Copy Style"
          keys={`${modSymbol}${altSymbol}C`}
          disabled={!overlayId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().copyOverlayStyle(overlayId))
          }
        />
        <Item
          label="Paste Style"
          keys={`${modSymbol}${altSymbol}V`}
          disabled={!overlayId || !useStudio.getState().styleClipboard}
          onClick={() =>
            run(() => overlayId && useStudio.getState().pasteOverlayStyle(overlayId))
          }
        />
        <Item
          label="Delete"
          keys="⌫"
          disabled={!overlayId && !useStudio.getState().selectedPanelId}
          onClick={() => run(() => useStudio.getState().deleteSelection())}
        />
      </MenuBtn>
      <MenuBtn
        label="Insert"
        open={open === "insert"}
        onOpen={() => setOpen((o) => (o === "insert" ? null : "insert"))}
      >
        <Item
          label="Speech"
          keys="T"
          onClick={() => run(() => useStudio.getState().addOverlay("speech"))}
        />
        <Item
          label="Thought"
          onClick={() => run(() => useStudio.getState().addOverlay("thought"))}
        />
        <Item
          label="Caption"
          onClick={() =>
            run(() => useStudio.getState().addOverlay("narration"))
          }
        />
        <Item
          label="Text"
          onClick={() => run(() => useStudio.getState().addOverlay("text"))}
        />
        <Item
          label="Title"
          keys={`${shiftSymbol}T`}
          onClick={() => run(() => insertTitle())}
        />
        <Item
          label="Sound Effect"
          onClick={() => run(() => useStudio.getState().addOverlay("sfx"))}
        />
        <Item
          label="Shout"
          onClick={() => run(() => useStudio.getState().addOverlay("shout"))}
        />
        <Item
          label="Whisper"
          onClick={() => run(() => useStudio.getState().addOverlay("whisper"))}
        />
        <Item
          label="Scream"
          onClick={() => run(() => useStudio.getState().addOverlay("scream"))}
        />
        <Item
          label="Radio balloon"
          onClick={() =>
            run(() => {
              const o = useStudio.getState().addOverlay("speech");
              useStudio.getState().updateOverlay(o.id, { balloonStyle: "radio" });
            })
          }
        />
        <Item
          label="Burst balloon"
          onClick={() =>
            run(() => {
              const o = useStudio.getState().addOverlay("shout");
              useStudio.getState().updateOverlay(o.id, { balloonStyle: "burst" });
            })
          }
        />
        <Divider />
        <Item
          label="Chain Balloon"
          disabled={!canFlipTail}
          onClick={() =>
            run(() => overlayId && useStudio.getState().addChainedOverlay(overlayId))
          }
        />
        <Item
          label="Unchain Balloon"
          disabled={!selectedOverlay?.chainId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().unchainOverlay(overlayId))
          }
        />
        <Item
          label="Speed lines"
          onClick={() => run(() => useStudio.getState().addOverlay("tone", undefined, "speed"))}
        />
        <Divider />
        <Item
          label="Script Line"
          onClick={() =>
            run(() => {
              useStudio.getState().addScriptLine();
              onScript();
            })
          }
        />
        <Item
          label="Chapter"
          onClick={() => run(() => useStudio.getState().addChapter())}
        />
        <Divider />
        <Item
          label="Place Logo"
          onClick={() => run(() => useStudio.getState().placeLogo())}
        />
      </MenuBtn>
      <MenuBtn
        label="Arrange"
        open={open === "arrange"}
        onOpen={() => setOpen((o) => (o === "arrange" ? null : "arrange"))}
      >
        <Item
          label="Bring to Front"
          keys={`${modSymbol}${altSymbol}]`}
          disabled={!overlayId}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().bringToFront(overlayId),
            )
          }
        />
        <Item
          label="Bring Forward"
          keys={`${modSymbol}]`}
          disabled={!overlayId || overlayIndex === overlays.length - 1}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().bringForward(overlayId),
            )
          }
        />
        <Item
          label="Send Backward"
          keys={`${modSymbol}[`}
          disabled={!overlayId || overlayIndex <= 0}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().sendBackward(overlayId),
            )
          }
        />
        <Item
          label="Send to Back"
          keys={`${modSymbol}${altSymbol}[`}
          disabled={!overlayId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().sendToBack(overlayId))
          }
        />
        <Divider />
        <Item
          label="Flip to Other Speaker"
          keys="F"
          disabled={!canFlipTail}
          onClick={() =>
            run(
              () =>
                overlayId &&
                useStudio.getState().flipOverlayTail(overlayId, "x"),
            )
          }
        />
        <Item
          label="Flip Tail Up / Down"
          keys={`${shiftSymbol}F`}
          disabled={!canFlipTail}
          onClick={() =>
            run(
              () =>
                overlayId &&
                useStudio.getState().flipOverlayTail(overlayId, "y"),
            )
          }
        />
        <Divider />
        <Item
          label="Chain Balloon"
          disabled={!canFlipTail}
          onClick={() =>
            run(() => overlayId && useStudio.getState().addChainedOverlay(overlayId))
          }
        />
        <Item
          label="Unchain Balloon"
          disabled={!selectedOverlay?.chainId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().unchainOverlay(overlayId))
          }
        />
        <Divider />
        <Item
          label="Move Page Earlier"
          onClick={() => run(() => useStudio.getState().movePageEarlier())}
        />
        <Item
          label="Move Page Later"
          onClick={() => run(() => useStudio.getState().movePageLater())}
        />
        <Item
          label="Make Cover"
          onClick={() =>
            run(() =>
              useStudio.getState().sendPageTo(
                useStudio.getState().currentPageId,
                "cover",
              ),
            )
          }
        />
      </MenuBtn>
      <MenuBtn
        label="View"
        open={open === "view"}
        onOpen={() => setOpen((o) => (o === "view" ? null : "view"))}
      >
        <Item
          label={thumbs ? "Hide Thumbnails" : "Show Thumbnails"}
          onClick={() => run(onThumbs)}
        />
        <Item label="Zoom In" keys={`${modSymbol}+`} onClick={() => run(onZoomIn)} />
        <Item label="Zoom Out" keys={`${modSymbol}-`} onClick={() => run(onZoomOut)} />
        <Item label="Fit Page" keys={`${modSymbol}0`} onClick={() => run(onZoomFit)} />
        <Divider />
        <Item
          label={spread ? "Single Page" : "Two-Page Spread"}
          onClick={() => run(onSpread)}
        />
        <Item label="Read Mode" keys="R" onClick={() => run(onRead)} />
        <Item label="Script" onClick={() => run(onScript)} />
        <Divider />
        <Item
          label={snapEdges ? "Snap to Edges ✓" : "Snap to Edges"}
          onClick={() =>
            run(() => {
              const s = useStudio.getState();
              s.setSnapEdges(!s.snapEdges);
            })
          }
        />
        <Divider />
        <Item
          label={theme === "dark" ? "Light Appearance" : "Dark Appearance"}
          onClick={() => run(onTheme)}
        />
      </MenuBtn>
    </div>
  );
}

function MenuBtn({
  label,
  open,
  onOpen,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className={cn(
          "h-[22px] rounded-[4px] px-1.5 text-[13px] leading-[22px]",
          open ? "bg-ink/10" : "hover:bg-ink/6",
        )}
      >
        {label}
      </button>
      {open ? (
        <div
          data-koma-menu
          className="koma-pop-in absolute left-0 top-[26px] z-50 min-w-[16rem] rounded-[12px] bg-surface/92 p-1.5 shadow-float backdrop-blur-2xl"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
