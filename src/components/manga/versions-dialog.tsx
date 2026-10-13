import { useEffect, useRef, useState } from "react";
import { Clock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTitle } from "@/components/manga/sheet";
import { PageThumb } from "@/components/manga/page-thumb";
import { useStudio } from "@/lib/manga/store";
import { relativeProjectTime, requestSave } from "@/lib/manga/project";
import {
  deleteVersion,
  kindLabel,
  listVersions,
  renameVersion,
  restoreVersion,
  restoreVersionAsCopy,
  saveVersionNow,
  versionTime,
  type VersionMeta,
} from "@/lib/manga/versions";
import { cn } from "@/lib/utils";

/**
 * File ▸ Browse All Versions…: the document's history on this device, a list
 * on the left and the chosen version on the right, with Restore, Restore a
 * Copy, a name for the version, and Delete. Restoring keeps what it replaces.
 */
export function VersionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useStudio((s) => s.projectId);
  const projectName = useStudio((s) => s.projectName);
  const [rows, setRows] = useState<VersionMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function refresh(keep?: string | null) {
    if (!projectId) {
      setRows([]);
      setLoaded(true);
      return;
    }
    const next = await listVersions(projectId);
    setRows(next);
    setLoaded(true);
    setSelectedId((cur) => {
      const want = keep ?? cur;
      return want && next.some((v) => v.id === want) ? want : (next[0]?.id ?? null);
    });
  }

  useEffect(() => {
    if (!open) {
      setRenameId(null);
      setConfirmDelete(false);
      setLoaded(false);
      return;
    }
    void refresh(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // The list arrives after the sheet opens: once it is in, the chosen row
  // takes focus so ↑↓ and Return work straight away; arrow moves carry focus.
  useEffect(() => {
    if (!open || !loaded || renameId !== null) return;
    const list = listRef.current;
    if (!list) return;
    const active = document.activeElement;
    const inList = active instanceof HTMLElement && list.contains(active);
    const inSheet = active instanceof HTMLElement && active.closest("[data-koma-dialog='versions']");
    if (!inList && inSheet && active !== list) return;
    list.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
  }, [open, loaded, selectedId, renameId]);

  function move(delta: number) {
    if (rows.length === 0) return;
    const i = Math.max(0, rows.findIndex((r) => r.id === selectedId));
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
    if (!next) return;
    setSelectedId(next.id);
    setConfirmDelete(false);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-koma-version="${next.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  async function guard<T>(work: () => Promise<T>, fail: string): Promise<T | null> {
    setBusy(true);
    try {
      return await work();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : fail);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!selected) return;
    const v = await guard(() => restoreVersion(selected.id), "Couldn’t restore that version");
    if (!v) return;
    useStudio.getState().setReadMode(false);
    toast.success(`Restored the version from ${versionTime(v.savedAt)}. The state it replaced is kept as “Before restore”.`);
    onClose();
  }

  async function restoreCopy() {
    if (!selected) return;
    const copy = await guard(() => restoreVersionAsCopy(selected.id), "Couldn’t restore a copy");
    if (!copy) return;
    useStudio.getState().setReadMode(false);
    toast.success(`Opened “${copy.name}” · the original stays as it is`);
    onClose();
  }

  async function saveNow() {
    const r = await guard(() => saveVersionNow(), "Couldn’t save a version");
    if (!r) return;
    toast.success(`Saved a version of “${r.record.name}”`);
    await refresh(r.version?.id ?? null);
  }

  async function remove() {
    if (!selected) return;
    const id = selected.id;
    const ok = await guard(() => deleteVersion(id), "Couldn’t delete that version");
    if (ok === null) return;
    setConfirmDelete(false);
    const i = rows.findIndex((r) => r.id === id);
    await refresh(rows[i + 1]?.id ?? rows[i - 1]?.id ?? null);
  }

  async function commitRename() {
    if (!renameId) return;
    const id = renameId;
    setRenameId(null);
    await guard(() => renameVersion(id, rename), "Couldn’t name that version");
    await refresh(id);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      koma="versions"
      aria-labelledby="versions-title"
      className="flex h-[min(34rem,calc(100dvh-6rem))] max-w-3xl flex-col p-0"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        listRef.current?.focus();
      }}
      onEscapeKeyDown={(e) => {
        if (renameId !== null || confirmDelete) {
          e.preventDefault();
          setRenameId(null);
          setConfirmDelete(false);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <SheetTitle asChild>
            <h2 id="versions-title" className="text-[15px] font-semibold">
              Versions
            </h2>
          </SheetTitle>
          <p className="mt-0.5 truncate text-[12px] text-muted" data-koma="versions-subtitle">
            {projectId
              ? `“${projectName}” · ${rows.length} version${rows.length === 1 ? "" : "s"} on this device · one is kept each time you save and every few minutes as you work`
              : "Save this manga to start its history."}
          </p>
        </div>
        {projectId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-koma="version-save"
            disabled={busy}
            onClick={() => void saveNow()}
          >
            Save a Version
          </Button>
        ) : (
          <Button type="button" size="sm" data-koma="version-save-first" onClick={() => requestSave()}>
            Save
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          role="listbox"
          aria-label="Versions"
          tabIndex={-1}
          data-koma="version-list"
          className="w-64 shrink-0 overflow-y-auto border-r border-line p-2 outline-none"
          onKeyDown={(e) => {
            if (renameId !== null) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter" && selected) {
              e.preventDefault();
              void restore();
            }
          }}
        >
          {rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-[12px] text-muted">
              {loaded
                ? projectId
                  ? "No versions yet."
                  : "Nothing to show until the manga is saved."
                : ""}
            </p>
          ) : (
            rows.map((row) => {
              const isSel = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  data-koma-version={row.id}
                  data-koma-kind={row.kind}
                  tabIndex={isSel ? 0 : -1}
                  onClick={() => {
                    setSelectedId(row.id);
                    setConfirmDelete(false);
                  }}
                  onDoubleClick={() => void restore()}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none",
                    isSel ? "bg-accent text-accent-fg" : "hover:bg-ink/5 focus-visible:bg-ink/5",
                  )}
                >
                  <Clock className={cn("mt-0.5 size-3.5 shrink-0", isSel ? "opacity-90" : "text-muted")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{kindLabel(row)}</span>
                    <span className={cn("block text-[11px]", isSel ? "opacity-85" : "text-muted")}>
                      {versionTime(row.savedAt)} · {relativeProjectTime(row.savedAt)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-5" data-koma="version-detail">
          {selected ? (
            <>
              <div className="w-44 shrink-0 overflow-hidden rounded-sm bg-paper shadow-page ring-1 ring-line [&_.koma-thumb]:w-full [&_.koma-thumb]:px-0 [&_.koma-thumb]:py-0 [&_.koma-thumb-label]:hidden">
                {selected.preview ? (
                  <PageThumb
                    page={selected.preview}
                    index={1}
                    selected={false}
                    passive
                    onClick={() => {}}
                    className="w-44 px-0 py-0"
                  />
                ) : (
                  <div className="aspect-[210/297] w-full bg-ink/5" />
                )}
              </div>
              <div className="w-full text-center">
                {renameId === selected.id ? (
                  <input
                    autoFocus
                    value={rename}
                    aria-label="Name this version"
                    data-koma="version-rename"
                    placeholder="Name this version"
                    onChange={(e) => setRename(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitRename();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setRenameId(null);
                      }
                    }}
                    onBlur={() => void commitRename()}
                    className="koma-field mx-auto h-8 w-56 text-center text-[13px]"
                  />
                ) : (
                  <p className="flex items-center justify-center gap-1.5 text-[13px] font-medium">
                    <span className="truncate">{kindLabel(selected)}</span>
                    <button
                      type="button"
                      aria-label="Name this version"
                      data-koma="version-rename-start"
                      className="koma-icon-btn size-6 rounded-md text-muted hover:text-ink"
                      onClick={() => {
                        setRename(selected.label ?? "");
                        setRenameId(selected.id);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </p>
                )}
                <p className="mt-0.5 text-[12px] text-muted">
                  {versionTime(selected.savedAt)} · {selected.pages} page{selected.pages === 1 ? "" : "s"}
                  {selected.name !== projectName ? ` · then “${selected.name}”` : ""}
                </p>
              </div>
              <div className="mt-auto flex w-full flex-wrap items-center justify-center gap-1.5 pt-2">
                {confirmDelete ? (
                  <>
                    <p className="mr-1 text-[12px] text-muted">Delete this version?</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-koma="version-delete-confirm"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-koma="version-delete"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-koma="version-restore-copy"
                      disabled={busy}
                      title="Open this version as a new project; the original stays as it is"
                      onClick={() => void restoreCopy()}
                    >
                      Restore a Copy
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      data-koma="version-restore"
                      disabled={busy}
                      title="Put the document back to this version; what it replaces is kept as a version"
                      onClick={() => void restore()}
                    >
                      Restore
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="my-auto flex flex-col items-center gap-2 text-center">
              <p className="text-[13px] text-muted">
                {projectId
                  ? "Panel Fox keeps a version each time you save, every few minutes as you work, and whenever you ask for one."
                  : "Once the manga is saved, every save and a snapshot every few minutes will show up here."}
              </p>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
