import { insertTitle } from "./actions";
import { copyOverlayToClipboard } from "./clipboard";
import { pageLabel } from "./book";
import { combo } from "./hotkeys";
import { isDialogue, pageOverlays } from "./lettering";
import type { ProjectMeta } from "./project";
import { useStudio } from "./store";
import { TEMPLATES } from "./templates";

/** One entry in the command palette: the same verbs as the menubar, searchable. */
export type Command = {
  id: string;
  label: string;
  group: string;
  keys?: string;
  /** Extra words the search should match (a layout's blurb, a page's number). */
  keywords?: string[];
  disabled?: boolean;
  /** A state item, drawn with a check mark the way the menus mark it. */
  checked?: boolean;
  run: () => void;
};

/** The callback bag the studio hands the menubar, plus the bits the palette adds. */
export type CommandContext = {
  apple: boolean;
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
  /** Saved projects on this device, for the Projects group. */
  projects: ProjectMeta[];
  onSwitchProject: (id: string) => void;
};

export const RECENT_COMMANDS_KEY = "koma-recent-cmds";
const RECENT_MAX = 5;

export function readRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string) {
  try {
    const next = [id, ...readRecentCommands().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: recents are a convenience, not state */
  }
}

/** Every menubar verb plus the dynamic page, layout and project lists. */
export function buildCommands(ctx: CommandContext): Command[] {
  const s = useStudio.getState();
  const k = (key: string, m: Parameters<typeof combo>[1] = {}) => combo(key, m, ctx.apple);
  const page = s.currentPage();
  const overlays = pageOverlays(page);
  const overlayId = s.selectedOverlayId;
  const overlayIndex = overlays.findIndex((o) => o.id === overlayId);
  const selectedOverlay = overlayId ? overlays.find((o) => o.id === overlayId) : undefined;
  const canFlipTail = Boolean(
    selectedOverlay && isDialogue(selectedOverlay.kind) && !selectedOverlay.locked,
  );
  const withOverlay = (fn: (id: string) => void) => () => {
    const id = useStudio.getState().selectedOverlayId;
    if (id) fn(id);
  };
  const toggleStyle = (key: "bold" | "italic") =>
    withOverlay((id) => {
      const o = useStudio.getState().currentPage().overlays.find((x) => x.id === id);
      if (o) useStudio.getState().updateOverlay(id, { [key]: !o[key] });
    });
  const add = (kind: Parameters<typeof s.addOverlay>[0]) => () => {
    useStudio.getState().addOverlay(kind);
  };

  const file: Command[] = [
    { id: "file.new", label: "New Project", group: "File", run: ctx.onNew },
    { id: "file.newBrochure", label: "New Brochure", group: "File", run: ctx.onNewBrochure },
    {
      id: "file.projects",
      label: "Projects…",
      group: "File",
      keys: k("O", { cmd: true }),
      keywords: ["open", "library"],
      run: ctx.onOpen,
    },
    { id: "file.rename", label: "Rename…", group: "File", run: ctx.onRename },
    { id: "file.save", label: "Save", group: "File", keys: k("S", { cmd: true }), run: ctx.onSave },
    {
      id: "file.saveCopy",
      label: "Save a Copy…",
      group: "File",
      keys: k("S", { cmd: true, shift: true }),
      keywords: ["duplicate project"],
      run: ctx.onSaveAs,
    },
    {
      id: "file.download",
      label: "Download Project File",
      group: "File",
      keywords: ["koma", "backup"],
      run: ctx.onDownloadProject,
    },
    {
      id: "file.newPage",
      label: "New Page",
      group: "File",
      keywords: ["add page"],
      run: () => useStudio.getState().addPage(),
    },
    {
      id: "file.duplicatePage",
      label: "Duplicate Page",
      group: "File",
      keys: k("D", { cmd: true, shift: true }),
      run: () => useStudio.getState().duplicatePage(),
    },
    {
      id: "file.import",
      label: "Import Photos or PDF…",
      group: "File",
      keywords: ["image", "picture", "photo"],
      run: ctx.onImport,
    },
    { id: "file.export", label: "Export…", group: "File", keys: k("E", { cmd: true }), run: ctx.onExport },
  ];

  const edit: Command[] = [
    {
      id: "edit.undo",
      label: "Undo",
      group: "Edit",
      keys: k("Z", { cmd: true }),
      disabled: !s.past.length,
      run: () => useStudio.getState().undo(),
    },
    {
      id: "edit.redo",
      label: "Redo",
      group: "Edit",
      keys: k("Z", { cmd: true, shift: true }),
      disabled: !s.future.length,
      run: () => useStudio.getState().redo(),
    },
    {
      id: "edit.cut",
      label: "Cut",
      group: "Edit",
      keys: k("X", { cmd: true }),
      disabled: !overlayId,
      run: withOverlay((id) => copyOverlayToClipboard(id, true)),
    },
    {
      id: "edit.copy",
      label: "Copy",
      group: "Edit",
      keys: k("C", { cmd: true }),
      disabled: !overlayId,
      run: withOverlay((id) => copyOverlayToClipboard(id)),
    },
    {
      id: "edit.paste",
      label: "Paste",
      group: "Edit",
      keys: k("V", { cmd: true }),
      disabled: !s.overlayClipboard,
      run: () => useStudio.getState().pasteOverlay(),
    },
    {
      id: "edit.duplicate",
      label: "Duplicate",
      group: "Edit",
      keys: k("D", { cmd: true }),
      disabled: !overlayId,
      run: () => useStudio.getState().duplicateOverlay(),
    },
    { id: "edit.bold", label: "Bold", group: "Edit", keys: k("B", { cmd: true }), disabled: !overlayId, run: toggleStyle("bold") },
    { id: "edit.italic", label: "Italic", group: "Edit", keys: k("I", { cmd: true }), disabled: !overlayId, run: toggleStyle("italic") },
    {
      id: "edit.copyStyle",
      label: "Copy Style",
      group: "Edit",
      keys: k("C", { cmd: true, alt: true }),
      disabled: !overlayId,
      run: withOverlay((id) => useStudio.getState().copyOverlayStyle(id)),
    },
    {
      id: "edit.pasteStyle",
      label: "Paste Style",
      group: "Edit",
      keys: k("V", { cmd: true, alt: true }),
      disabled: !overlayId || !s.styleClipboard,
      run: withOverlay((id) => useStudio.getState().pasteOverlayStyle(id)),
    },
    {
      id: "edit.delete",
      label: "Delete",
      group: "Edit",
      keys: "⌫",
      keywords: ["remove"],
      disabled: !overlayId && !s.selectedPanelId,
      run: () => useStudio.getState().deleteSelection(),
    },
  ];

  const insert: Command[] = [
    { id: "insert.speech", label: "Speech", group: "Insert", keys: "T", keywords: ["balloon", "bubble"], run: add("speech") },
    { id: "insert.thought", label: "Thought", group: "Insert", keywords: ["balloon", "bubble", "cloud"], run: add("thought") },
    { id: "insert.caption", label: "Caption", group: "Insert", keywords: ["narration", "box"], run: add("narration") },
    { id: "insert.text", label: "Text", group: "Insert", keywords: ["label"], run: add("text") },
    { id: "insert.title", label: "Title", group: "Insert", keys: k("T", { shift: true }), run: () => insertTitle() },
    { id: "insert.sfx", label: "Sound Effect", group: "Insert", keywords: ["sfx", "onomatopoeia"], run: add("sfx") },
    { id: "insert.shout", label: "Shout", group: "Insert", keywords: ["balloon"], run: add("shout") },
    { id: "insert.whisper", label: "Whisper", group: "Insert", keywords: ["balloon"], run: add("whisper") },
    { id: "insert.scream", label: "Scream", group: "Insert", keywords: ["balloon"], run: add("scream") },
    {
      id: "insert.radio",
      label: "Radio balloon",
      group: "Insert",
      keywords: ["electric", "phone"],
      run: () => {
        const o = useStudio.getState().addOverlay("speech");
        useStudio.getState().updateOverlay(o.id, { balloonStyle: "radio" });
      },
    },
    {
      id: "insert.burst",
      label: "Burst balloon",
      group: "Insert",
      keywords: ["spiky", "explosion"],
      run: () => {
        const o = useStudio.getState().addOverlay("shout");
        useStudio.getState().updateOverlay(o.id, { balloonStyle: "burst" });
      },
    },
    {
      id: "insert.chain",
      label: "Chain Balloon",
      group: "Insert",
      keywords: ["link", "connect"],
      disabled: !canFlipTail,
      run: withOverlay((id) => useStudio.getState().addChainedOverlay(id)),
    },
    {
      id: "insert.unchain",
      label: "Unchain Balloon",
      group: "Insert",
      disabled: !selectedOverlay?.chainId,
      run: withOverlay((id) => useStudio.getState().unchainOverlay(id)),
    },
    {
      id: "insert.speedLines",
      label: "Speed lines",
      group: "Insert",
      keywords: ["tone", "motion"],
      run: () => useStudio.getState().addOverlay("tone", undefined, "speed"),
    },
    {
      id: "insert.scriptLine",
      label: "Script Line",
      group: "Insert",
      run: () => {
        useStudio.getState().addScriptLine();
        ctx.onScript();
      },
    },
    { id: "insert.chapter", label: "Chapter", group: "Insert", run: () => useStudio.getState().addChapter() },
    { id: "insert.logo", label: "Place Logo", group: "Insert", keywords: ["sticker", "brand"], run: () => useStudio.getState().placeLogo() },
  ];

  const arrange: Command[] = [
    {
      id: "arrange.front",
      label: "Bring to Front",
      group: "Arrange",
      keys: k("]", { cmd: true, alt: true }),
      disabled: !overlayId,
      run: withOverlay((id) => useStudio.getState().bringToFront(id)),
    },
    {
      id: "arrange.forward",
      label: "Bring Forward",
      group: "Arrange",
      keys: k("]", { cmd: true }),
      disabled: !overlayId || overlayIndex === overlays.length - 1,
      run: withOverlay((id) => useStudio.getState().bringForward(id)),
    },
    {
      id: "arrange.backward",
      label: "Send Backward",
      group: "Arrange",
      keys: k("[", { cmd: true }),
      disabled: !overlayId || overlayIndex <= 0,
      run: withOverlay((id) => useStudio.getState().sendBackward(id)),
    },
    {
      id: "arrange.back",
      label: "Send to Back",
      group: "Arrange",
      keys: k("[", { cmd: true, alt: true }),
      disabled: !overlayId,
      run: withOverlay((id) => useStudio.getState().sendToBack(id)),
    },
    {
      id: "arrange.flipX",
      label: "Flip to Other Speaker",
      group: "Arrange",
      keys: "F",
      keywords: ["tail", "mirror"],
      disabled: !canFlipTail,
      run: withOverlay((id) => useStudio.getState().flipOverlayTail(id, "x")),
    },
    {
      id: "arrange.flipY",
      label: "Flip Tail Up / Down",
      group: "Arrange",
      keys: k("F", { shift: true }),
      disabled: !canFlipTail,
      run: withOverlay((id) => useStudio.getState().flipOverlayTail(id, "y")),
    },
    {
      id: "arrange.pageEarlier",
      label: "Move Page Earlier",
      group: "Arrange",
      keywords: ["reorder", "up"],
      run: () => useStudio.getState().movePageEarlier(),
    },
    {
      id: "arrange.pageLater",
      label: "Move Page Later",
      group: "Arrange",
      keywords: ["reorder", "down"],
      run: () => useStudio.getState().movePageLater(),
    },
    {
      id: "arrange.makeCover",
      label: "Make Cover",
      group: "Arrange",
      keywords: ["first page"],
      run: () => {
        const st = useStudio.getState();
        st.sendPageTo(st.currentPageId, "cover");
      },
    },
  ];

  const view: Command[] = [
    { id: "view.thumbs", label: "Thumbnails", group: "View", keys: k("P", { cmd: true, alt: true }), keywords: ["pages", "sidebar", "navigator"], checked: ctx.thumbs, run: ctx.onThumbs },
    { id: "view.zoomIn", label: "Zoom In", group: "View", keys: k("+", { cmd: true }), run: ctx.onZoomIn },
    { id: "view.zoomOut", label: "Zoom Out", group: "View", keys: k("-", { cmd: true }), run: ctx.onZoomOut },
    { id: "view.fit", label: "Fit Page", group: "View", keys: k("0", { cmd: true }), keywords: ["zoom to fit"], run: ctx.onZoomFit },
    { id: "view.spread", label: "Two-Page Spread", group: "View", keywords: ["facing", "double"], checked: ctx.spread, run: ctx.onSpread },
    { id: "view.read", label: "Read Mode", group: "View", keys: "R", keywords: ["preview", "reader"], run: ctx.onRead },
    { id: "view.script", label: "Script", group: "View", keywords: ["dialogue", "lines"], run: ctx.onScript },
    {
      id: "view.snap",
      label: "Snap to Edges",
      group: "View",
      keywords: ["align", "magnet"],
      checked: s.snapEdges,
      run: () => {
        const st = useStudio.getState();
        st.setSnapEdges(!st.snapEdges);
      },
    },
    {
      id: "view.handInk",
      label: "Hand-drawn Balloons",
      group: "View",
      keywords: ["ink", "pen", "wobble"],
      checked: s.handInk,
      run: () => {
        const st = useStudio.getState();
        st.setHandInk(!st.handInk);
      },
    },
    {
      id: "view.theme",
      label: ctx.theme === "dark" ? "Light Appearance" : "Dark Appearance",
      group: "View",
      keywords: ["theme", "dark mode", "light mode"],
      run: ctx.onTheme,
    },
  ];

  const pages: Command[] = s.pages.map((p, i) => {
    const label = pageLabel(s.pages, p.id, s.book.coverFirst);
    return {
      id: `page.${p.id}`,
      label: `Go to ${label}`,
      group: "Pages",
      keywords: ["page", String(i + 1), label],
      checked: p.id === s.currentPageId,
      run: () => useStudio.getState().setCurrentPage(p.id),
    };
  });

  const layouts: Command[] = TEMPLATES.map((spec) => ({
    id: `layout.${spec.id}`,
    label: `Apply Layout: ${spec.name}`,
    group: "Layouts",
    keywords: ["layout", "template", "grid", spec.blurb, spec.group ?? "manga"],
    checked: spec.id === page.templateId,
    run: () => useStudio.getState().setTemplate(spec.id),
  }));

  const projects: Command[] = ctx.projects
    .filter((p) => p.id !== s.projectId)
    .map((p) => ({
      id: `project.${p.id}`,
      label: `Open “${p.name}”`,
      group: "Projects",
      keywords: ["project", "switch", "open", p.name],
      run: () => ctx.onSwitchProject(p.id),
    }));

  return [...file, ...edit, ...insert, ...arrange, ...view, ...pages, ...layouts, ...projects];
}
