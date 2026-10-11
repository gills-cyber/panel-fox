import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Search } from "lucide-react";
import { cn, prefersReducedMotion } from "@/lib/utils";
import { combo, useApplePlatform } from "@/lib/manga/hotkeys";
import { useStudio, selectionIds } from "@/lib/manga/store";
import { copyOverlayToClipboard } from "@/lib/manga/clipboard";
import { Floating } from "@/components/manga/floating";
import { insertTitle } from "@/lib/manga/actions";
import { pageOverlays, isDialogue } from "@/lib/manga/lettering";

type MenuId = "file" | "edit" | "insert" | "arrange" | "view" | null;
const MENU_ORDER: Exclude<MenuId, null>[] = ["file", "edit", "insert", "arrange", "view"];

function Shortcut({ keys }: { keys: string }) {
  return <span className="koma-keys ml-8 text-[13px] tabular-nums opacity-55">{keys}</span>;
}

function Item({
  label,
  keys,
  checked,
  disabled,
  onClick,
  href,
  download,
}: {
  label: string;
  keys?: string;
  /** Shown as a check in the leading gutter, the way NSMenu marks a state item. */
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  download?: string;
}) {
  const className =
    "koma-menu-item relative flex h-[26px] w-full items-center justify-between rounded-[5px] pl-6 pr-2 text-left text-[13px] text-ink outline-none hover:bg-accent hover:text-accent-fg focus-visible:bg-accent focus-visible:text-accent-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink";
  const mark = checked ? (
    <Check
      aria-hidden
      className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2"
      strokeWidth={2.5}
    />
  ) : null;
  if (href) {
    return (
      <a
        href={href}
        download={download}
        target="_blank"
        rel="noopener"
        role="menuitem"
        className={className}
        onPointerDown={(e) => e.currentTarget.focus()}
        onClick={onClick}
      >
        {mark}
        {label}
        {keys ? <Shortcut keys={keys} /> : <span />}
      </a>
    );
  }
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onPointerDown={(e) => e.currentTarget.focus()}
      onClick={onClick}
      className={className}
    >
      {mark}
      {label}
      {keys ? <Shortcut keys={keys} /> : <span />}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-line" />;
}

function AppMenuInner({
  thumbs,
  onThumbs,
  onExport,
  onImport,
  onSave,
  onSaveAs,
  onOpen,
  onRename,
  onNew,
  onNewBrochure,
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
  onZoomActual,
  onCommands,
}: {
  thumbs: boolean;
  onThumbs: () => void;
  onExport: () => void;
  onImport: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onRename: () => void;
  onNew: () => void;
  onNewBrochure: () => void;
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
  onZoomActual: () => void;
  onCommands: () => void;
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
  const handInk = useStudio((s) => s.handInk);
  const hasOverlayClip = useStudio((s) => s.overlayClipboard !== null);
  const selectedCount = useStudio((s) => selectionIds(s).length);
  const canFlipTail = Boolean(
    selectedOverlay && isDialogue(selectedOverlay.kind) && !selectedOverlay.locked,
  );
  const apple = useApplePlatform();
  const k = (key: string, m: Parameters<typeof combo>[1] = {}) => combo(key, m, apple);

  useEffect(() => {
    function close(e: PointerEvent) {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-koma-menubar],[data-koma-menu]")) return;
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

  /** Blink the chosen item, then act and close, the way NSMenu does. */
  function run(fn: () => void) {
    const el = document.activeElement;
    const inMenu = el instanceof HTMLElement && el.closest("[data-koma-menu]");
    const delay = inMenu && !prefersReducedMotion() ? 140 : 0;
    if (inMenu) el.setAttribute("data-flash", "");
    if (!delay) {
      fn();
      setOpen(null);
      return;
    }
    window.setTimeout(() => {
      fn();
      setOpen(null);
    }, delay);
  }

  function move(dir: 1 | -1) {
    setOpen((o) => {
      if (!o) return o;
      const i = MENU_ORDER.indexOf(o);
      return MENU_ORDER[(i + dir + MENU_ORDER.length) % MENU_ORDER.length]!;
    });
  }

  return (
    <div
      data-koma-menubar
      className="koma-glass relative z-50 hidden h-[1.75rem] shrink-0 items-center gap-0 px-1.5 text-[13px] text-ink md:flex"
    >
      <MenuBtn
        id="file"
        label="File"
        open={open === "file"}
        anyOpen={open !== null}
        onOpen={() => setOpen((o) => (o === "file" ? null : "file"))}
        onHover={() => setOpen("file")}
        onMove={move}
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
          label="Projects…"
          keys={k("O", { cmd: true })}
          onClick={() => run(onOpen)}
        />
        <Item label="Rename…" onClick={() => run(onRename)} />
        <Divider />
        <Item
          label="Save"
          keys={k("S", { cmd: true })}
          onClick={() => run(onSave)}
        />
        <Item
          label="Save a Copy…"
          keys={k("S", { cmd: true, shift: true })}
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
          keys={k("D", { cmd: true, shift: true })}
          onClick={() => run(() => useStudio.getState().duplicatePage())}
        />
        <Divider />
        <Item label="Import Photos or PDF…" onClick={() => run(onImport)} />
        <Divider />
        <Item
          label="Export…"
          keys={k("E", { cmd: true })}
          onClick={() => run(onExport)}
        />
      </MenuBtn>
      <MenuBtn
        id="edit"
        label="Edit"
        open={open === "edit"}
        anyOpen={open !== null}
        onOpen={() => setOpen((o) => (o === "edit" ? null : "edit"))}
        onHover={() => setOpen("edit")}
        onMove={move}
      >
        <Item
          label="Undo"
          keys={k("Z", { cmd: true })}
          disabled={!past}
          onClick={() => run(() => useStudio.getState().undo())}
        />
        <Item
          label="Redo"
          keys={k("Z", { cmd: true, shift: true })}
          disabled={!future}
          onClick={() => run(() => useStudio.getState().redo())}
        />
        <Divider />
        <Item
          label="Cut"
          keys={k("X", { cmd: true })}
          disabled={!overlayId}
          onClick={() => run(() => copyOverlayToClipboard(overlayId, true))}
        />
        <Item
          label="Copy"
          keys={k("C", { cmd: true })}
          disabled={!overlayId}
          onClick={() => run(() => copyOverlayToClipboard(overlayId))}
        />
        <Item
          label="Paste"
          keys={k("V", { cmd: true })}
          disabled={!hasOverlayClip}
          onClick={() => run(() => useStudio.getState().pasteOverlay())}
        />
        <Item
          label="Duplicate"
          keys={k("D", { cmd: true })}
          disabled={!overlayId}
          onClick={() => run(() => useStudio.getState().duplicateOverlay())}
        />
        <Item
          label="Select All"
          keys={k("A", { cmd: true })}
          disabled={!overlays.length}
          onClick={() => run(() => useStudio.getState().selectAllOverlays())}
        />
        <Item
          label="Bold"
          keys={k("B", { cmd: true })}
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
          keys={k("I", { cmd: true })}
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
          keys={k("C", { cmd: true, alt: true })}
          disabled={!overlayId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().copyOverlayStyle(overlayId))
          }
        />
        <Item
          label="Paste Style"
          keys={k("V", { cmd: true, alt: true })}
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
        id="insert"
        label="Insert"
        open={open === "insert"}
        anyOpen={open !== null}
        onOpen={() => setOpen((o) => (o === "insert" ? null : "insert"))}
        onHover={() => setOpen("insert")}
        onMove={move}
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
          keys={k("T", { shift: true })}
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
        id="arrange"
        label="Arrange"
        open={open === "arrange"}
        anyOpen={open !== null}
        onOpen={() => setOpen((o) => (o === "arrange" ? null : "arrange"))}
        onHover={() => setOpen("arrange")}
        onMove={move}
      >
        <Item
          label="Bring to Front"
          keys={k("]", { cmd: true, alt: true })}
          disabled={!overlayId}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().bringToFront(overlayId),
            )
          }
        />
        <Item
          label="Bring Forward"
          keys={k("]", { cmd: true })}
          disabled={!overlayId || overlayIndex === overlays.length - 1}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().bringForward(overlayId),
            )
          }
        />
        <Item
          label="Send Backward"
          keys={k("[", { cmd: true })}
          disabled={!overlayId || overlayIndex <= 0}
          onClick={() =>
            run(
              () => overlayId && useStudio.getState().sendBackward(overlayId),
            )
          }
        />
        <Item
          label="Send to Back"
          keys={k("[", { cmd: true, alt: true })}
          disabled={!overlayId}
          onClick={() =>
            run(() => overlayId && useStudio.getState().sendToBack(overlayId))
          }
        />
        <Divider />
        {(
          [
            ["Align Left", "left"],
            ["Align Center", "centerX"],
            ["Align Right", "right"],
            ["Align Top", "top"],
            ["Align Middle", "centerY"],
            ["Align Bottom", "bottom"],
          ] as const
        ).map(([label, mode]) => (
          <Item
            key={mode}
            label={label}
            disabled={!overlayId}
            onClick={() => run(() => useStudio.getState().alignSelection(mode))}
          />
        ))}
        <Item
          label="Distribute Horizontally"
          disabled={selectedCount < 3}
          onClick={() => run(() => useStudio.getState().distributeSelection("x"))}
        />
        <Item
          label="Distribute Vertically"
          disabled={selectedCount < 3}
          onClick={() => run(() => useStudio.getState().distributeSelection("y"))}
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
          keys={k("F", { shift: true })}
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
        id="view"
        label="View"
        open={open === "view"}
        anyOpen={open !== null}
        onOpen={() => setOpen((o) => (o === "view" ? null : "view"))}
        onHover={() => setOpen("view")}
        onMove={move}
      >
        <Item
          label="Thumbnails"
          keys={k("P", { cmd: true, alt: true })}
          checked={thumbs}
          onClick={() => run(onThumbs)}
        />
        <Item label="Zoom In" keys={k("+", { cmd: true })} onClick={() => run(onZoomIn)} />
        <Item label="Zoom Out" keys={k("-", { cmd: true })} onClick={() => run(onZoomOut)} />
        <Item label="Fit Page" keys={k("0", { cmd: true })} onClick={() => run(onZoomFit)} />
        <Item
          label="Actual Size"
          keys={k("0", { cmd: true, alt: true })}
          onClick={() => run(onZoomActual)}
        />
        <Divider />
        <Item label="Two-Page Spread" checked={spread} onClick={() => run(onSpread)} />
        <Item label="Read Mode" keys="R" onClick={() => run(onRead)} />
        <Item label="Script" onClick={() => run(onScript)} />
        <Divider />
        <Item
          label="Snap to Edges"
          checked={snapEdges}
          onClick={() =>
            run(() => {
              const s = useStudio.getState();
              s.setSnapEdges(!s.snapEdges);
            })
          }
        />
        <Item
          label="Hand-drawn Balloons"
          checked={handInk}
          onClick={() =>
            run(() => {
              const s = useStudio.getState();
              s.setHandInk(!s.handInk);
            })
          }
        />
        <Divider />
        <Item
          label={theme === "dark" ? "Light Appearance" : "Dark Appearance"}
          onClick={() => run(onTheme)}
        />
        <Divider />
        <Item
          label="Any Command…"
          keys={k("K", { cmd: true })}
          onClick={() => run(onCommands)}
        />
      </MenuBtn>
      <button
        type="button"
        aria-label="Search commands"
        title={`Any Command… ${k("K", { cmd: true })}`}
        data-koma="menu-search"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          setOpen(null);
          onCommands();
        }}
        className="koma-press ml-auto flex size-[22px] items-center justify-center rounded-[4px] text-ink/80 hover:bg-ink/6 hover:text-ink"
      >
        <Search className="size-[15px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}

function MenuBtn({
  id,
  label,
  open,
  anyOpen,
  onOpen,
  onHover,
  onMove,
  children,
}: {
  id: Exclude<MenuId, null>;
  label: string;
  open: boolean;
  /** Some menu in the bar is open, so sliding onto this title switches to it. */
  anyOpen: boolean;
  onOpen: () => void;
  onHover: () => void;
  onMove: (dir: 1 | -1) => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);

  // Fade the panel out for a beat after it closes (NSMenu fades, never pops).
  useEffect(() => {
    const prev = wasOpen.current;
    wasOpen.current = open;
    if (!prev || open) return;
    if (prefersReducedMotion()) return;
    setClosing(true);
    const t = window.setTimeout(() => setClosing(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open) {
      setClosing(false);
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"),
    ];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        go(i + 1);
        break;
      case "ArrowUp":
        go(i < 0 ? items.length - 1 : i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(items.length - 1);
        break;
      case "ArrowRight":
        onMove(1);
        break;
      case "ArrowLeft":
        onMove(-1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-koma={`menu-${id}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerEnter={() => {
          if (anyOpen && !open) onHover();
        }}
        className={cn(
          "h-[22px] rounded-[4px] px-1.5 text-[13px] leading-[22px]",
          open ? "bg-ink/10" : "hover:bg-ink/6",
        )}
      >
        {label}
      </button>
      {open || closing ? (
        <Floating
          ref={panelRef}
          anchor={btnRef.current}
          align="start"
          offset={4}
          role="menu"
          tabIndex={-1}
          data-koma-menu=""
          data-state={open ? "open" : "closing"}
          className="min-w-[16rem] rounded-[12px] bg-surface/92 p-1.5 shadow-float outline-none backdrop-blur-2xl"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {children}
        </Floating>
      ) : null}
    </div>
  );
}

type AppMenuProps = Parameters<typeof AppMenuInner>[0];
const MemoAppMenu = memo(AppMenuInner);

/**
 * The menubar is static between opens; the studio passes fresh closures every
 * render, so route them through stable proxies and let the memo skip the work.
 */
export function AppMenu(props: AppMenuProps) {
  const latest = useRef(props);
  latest.current = props;
  const stable = useMemo(() => {
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const key of Object.keys(latest.current)) {
      if (!key.startsWith("on")) continue;
      out[key] = (...args: unknown[]) =>
        (latest.current as unknown as Record<string, (...a: unknown[]) => unknown>)[key]?.(...args);
    }
    return out;
  }, []);
  return <MemoAppMenu {...props} {...(stable as Partial<AppMenuProps>)} />;
}
