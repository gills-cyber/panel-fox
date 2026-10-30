import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteNamedProject,
  documentHasWork,
  duplicateNamedProject,
  listProjects,
  relativeProjectTime,
  renameNamedProject,
  requestOpenProjects,
  requestSave,
  requestSaveAs,
  saveNamedProject,
  startNewProject,
  switchToProject,
  type ProjectMeta,
} from "@/lib/manga/project";
import { useStudio } from "@/lib/manga/store";
import { PageThumb } from "@/components/manga/page-thumb";
import { cn } from "@/lib/utils";

export function SaveAsDialog({
  open,
  onClose,
  onSaved,
  asCopy = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (name: string, count: number) => void;
  asCopy?: boolean;
}) {
  const current = useStudio((s) => s.projectName);
  const projectId = useStudio((s) => s.projectId);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const base =
      asCopy && current && current !== "Untitled"
        ? `${current} copy`
        : current || "Untitled";
    setName(base);
    void listProjects().then((rows) => {
      if (alive) setExisting(rows);
    });
    return () => {
      alive = false;
    };
  }, [open, current, projectId, asCopy]);

  if (!open) return null;

  const copy = asCopy || Boolean(projectId);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button type="button" className="koma-scrim absolute inset-0" aria-label="Close" onClick={onClose} />
      <form
        className="koma-glass-surface relative w-full max-w-sm rounded-[16px] p-5 shadow-float"
        data-koma-dialog="save-project"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void saveNamedProject(name, copy)
            .then(async (record) => {
              const rows = await listProjects();
              onSaved?.(record.name, rows.length);
              onClose();
            })
            .finally(() => setBusy(false));
        }}
      >
        <h2 className="text-[15px] font-semibold">
          {copy ? "Save a Copy" : "Save Project"}
        </h2>
        <p className="mt-1 text-[12px] text-muted">
          {copy
            ? "Adds another manga on this device. Your other projects stay."
            : "Saved on this device. You can keep as many projects as you want."}
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="mt-3 h-10 w-full rounded-md border border-line bg-paper-white px-2.5 text-[16px] outline-none ring-accent focus:ring-2"
        />
        {existing.length ? (
          <p className="mt-2 text-[11px] text-muted">
            {existing.length} project{existing.length === 1 ? "" : "s"} already
            saved
            {existing.length <= 4
              ? `: ${existing.map((r) => r.name).join(", ")}`
              : ""}
            .
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted">This will be your first saved project.</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

export function OpenProjectDialog({
  open,
  onClose,
  onOpenFile,
  onNew,
  onSaveAs,
  onSaveFirst,
  onMakeChapter,
}: {
  open: boolean;
  onClose: () => void;
  onOpenFile: () => void;
  onMakeChapter?: () => void;
  onNew?: () => void;
  onSaveAs?: () => void;
  onSaveFirst?: () => void;
}) {
  const [rows, setRows] = useState<ProjectMeta[]>([]);
  const [query, setQuery] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const currentId = useStudio((s) => s.projectId);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRenameId(null);
      setConfirmId(null);
      return;
    }
    void listProjects().then(setRows);
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  if (!open) return null;

  async function refresh() {
    setRows(await listProjects());
  }

  async function openRow(id: string) {
    const result = await switchToProject(id);
    if (result.stashed?.saved && result.switched) {
      toast.message(`Kept “${result.stashed.name}” in Projects`);
    }
    useStudio.getState().setReadMode(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
      <button type="button" className="koma-scrim absolute inset-0" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-labelledby="projects-title"
        data-koma-dialog="projects"
        className="koma-glass-surface relative flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-[18px] shadow-float"
      >
        <div className="border-b border-line px-4 py-3">
          <h2 id="projects-title" className="text-[15px] font-semibold">
            Projects
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {rows.length
              ? `${rows.length} manga on this device · search, open, or save another`
              : "Save this manga to keep it. You can store as many as you want."}
          </p>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project…"
              aria-label="Find a project"
              data-koma="project-search"
              className="h-10 w-full rounded-md border border-line bg-paper-white pl-8 pr-2.5 text-[16px] outline-none ring-accent focus:ring-2"
            />
          </label>
          {!currentId && documentHasWork() ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-ink/5 px-2.5 py-2">
              <p className="text-[12px] text-ink">This manga isn’t in the library yet.</p>
              <Button
                type="button"
                size="sm"
                data-koma="project-save-first"
                onClick={() => onSaveFirst?.() ?? onSaveAs?.()}
              >
                Save
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="text-[13px] text-muted">No saved projects yet.</p>
              {onSaveFirst || onSaveAs ? (
                <Button
                  type="button"
                  size="sm"
                  data-koma="project-save-first"
                  onClick={() => onSaveFirst?.() ?? onSaveAs?.()}
                >
                  Save this manga
                </Button>
              ) : null}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-10 text-center text-[13px] text-muted">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-koma="project-list">
              {filtered.map((row) => {
                const current = row.id === currentId;
                const deleting = confirmId === row.id;
                return (
                  <div
                    key={row.id}
                    data-koma-project={row.id}
                    data-koma-project-name={row.name}
                    className={cn(
                      "overflow-hidden rounded-md border border-line p-2",
                      current ? "ring-2 ring-accent" : "hover:bg-ink/4",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 text-left"
                      onClick={() => {
                        if (renameId === row.id || deleting) return;
                        void openRow(row.id);
                      }}
                    >
                      <div className="pointer-events-none w-16 shrink-0 overflow-hidden rounded-sm bg-paper ring-1 ring-line [&_.koma-thumb]:w-full [&_.koma-thumb]:px-0 [&_.koma-thumb]:py-0 [&_.koma-thumb-label]:hidden">
                        {row.preview ? (
                          <PageThumb
                            page={row.preview}
                            index={1}
                            selected={false}
                            passive
                            onClick={() => {}}
                            className="w-16 px-0 py-0"
                          />
                        ) : (
                          <div className="aspect-[210/297] w-full bg-ink/5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        {renameId === row.id ? (
                          <input
                            autoFocus
                            value={rename}
                            aria-label="Rename project"
                            data-koma="project-rename"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRename(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void renameNamedProject(row.id, rename).then(() => {
                                  setRenameId(null);
                                  void refresh();
                                });
                              }
                              if (e.key === "Escape") setRenameId(null);
                            }}
                            onBlur={() => {
                              if (!rename.trim()) {
                                setRenameId(null);
                                return;
                              }
                              void renameNamedProject(row.id, rename).then(() => {
                                setRenameId(null);
                                void refresh();
                              });
                            }}
                            className="h-8 w-full rounded-md border border-line bg-paper-white px-2 text-[13px] outline-none ring-accent focus:ring-2"
                          />
                        ) : (
                          <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                            <span className="truncate">{row.name}</span>
                            {current ? (
                              <span className="shrink-0 text-[10px] font-normal text-accent">
                                Open
                              </span>
                            ) : null}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted">
                          {row.pages} page{row.pages === 1 ? "" : "s"} ·{" "}
                          {relativeProjectTime(row.updatedAt)}
                        </p>
                      </div>
                    </button>
                    {deleting ? (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                        <p className="mr-auto text-[11px] text-muted">Delete this manga?</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-koma="project-delete-confirm"
                          onClick={() => {
                            void deleteNamedProject(row.id).then(() => {
                              setConfirmId(null);
                              void refresh();
                              toast.message(`Deleted “${row.name}”`);
                            });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          data-koma="project-read"
                          title="Read this manga"
                          onClick={() => {
                            void (async () => {
                              if (row.id !== currentId) {
                                const result = await switchToProject(row.id);
                                if (result.stashed?.saved && result.switched) {
                                  toast.message(`Kept “${result.stashed.name}” in Projects`);
                                }
                              }
                              useStudio.getState().setReadMode(true);
                              onClose();
                            })();
                          }}
                        >
                          <BookOpen className="size-3.5" />
                          Read
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-koma="project-edit"
                          title="Open in the editor"
                          onClick={() => {
                            void (async () => {
                              if (row.id !== currentId) {
                                const result = await switchToProject(row.id);
                                if (result.stashed?.saved && result.switched) {
                                  toast.message(`Kept “${result.stashed.name}” in Projects`);
                                }
                              }
                              useStudio.getState().setReadMode(false);
                              onClose();
                            })();
                          }}
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setConfirmId(null);
                            setRenameId(row.id);
                            setRename(row.name);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-koma="project-duplicate"
                          onClick={() => {
                            void duplicateNamedProject(row.id).then((copy) => {
                              void refresh();
                              toast.success(`Copied as “${copy.name}”`);
                            });
                          }}
                        >
                          Duplicate
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-koma="project-delete"
                          onClick={() => {
                            setRenameId(null);
                            setConfirmId(row.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-line px-3 py-2">
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-koma="project-new"
              onClick={() => {
                void startNewProject().then((stashed) => {
                  onNew?.();
                  onClose();
                  if (stashed.saved) {
                    toast.message(`Saved “${stashed.name}”. Started a new manga.`);
                  } else {
                    toast.message("New project");
                  }
                });
              }}
            >
              New
            </Button>
            {onSaveAs ? (
              <Button type="button" variant="ghost" size="sm" onClick={onSaveAs}>
                Save a Copy
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={onOpenFile}>
              Open File…
            </Button>
            {onMakeChapter ? (
              <Button type="button" variant="ghost" size="sm" data-koma="project-make" onClick={onMakeChapter}>
                New from Images…
              </Button>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="sm" data-koma="project-close" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProjectPanel() {
  const name = useStudio((s) => s.projectName);
  const id = useStudio((s) => s.projectId);
  const [recent, setRecent] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const rows = await listProjects();
      if (alive) setRecent(rows);
    }
    void load();
    const t = window.setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [id, name]);

  return (
    <div className="space-y-3" data-koma="project-panel">
      <div>
        <p className="text-xs font-medium text-muted">This manga</p>
        <p className="mt-1 truncate text-sm font-medium" data-koma="project-name">
          {name || "Untitled"}
          {!id ? (
            <span className="ml-1.5 text-[11px] font-normal text-muted">
              not saved yet
            </span>
          ) : null}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button type="button" variant="outline" size="sm" data-koma="project-save" onClick={() => requestSave()}>
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => requestSaveAs(true)}>
          Save a Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-koma="project-panel-library"
          onClick={() => requestOpenProjects()}
        >
          Projects…
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-koma="project-new"
          onClick={() => {
            void startNewProject().then((stashed) => {
              if (stashed.saved) {
                toast.message(`Saved “${stashed.name}”. Started a new manga.`);
              } else {
                toast.message("New project");
              }
            });
          }}
        >
          New
        </Button>
      </div>
      {recent.length ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">Recent</p>
            <button
              type="button"
              className="text-[11px] font-medium text-accent hover:underline"
              onClick={() => requestOpenProjects()}
            >
              View all
            </button>
          </div>
          <ul className="space-y-1">
            {recent.slice(0, 6).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-koma-project={row.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    row.id === id ? "bg-accent/10 ring-1 ring-accent" : "hover:bg-ink/5",
                  )}
                  onClick={() => {
                    if (row.id === id) {
                      requestOpenProjects();
                      return;
                    }
                    void switchToProject(row.id).then((result) => {
                      if (result.stashed?.saved && result.switched) {
                        toast.message(`Kept “${result.stashed.name}” in Projects`);
                      }
                    });
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted">
                    {relativeProjectTime(row.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted">
          Save this manga to keep it on this device. You can store as many
          projects as you want — search and open them anytime.
        </p>
      )}
    </div>
  );
}