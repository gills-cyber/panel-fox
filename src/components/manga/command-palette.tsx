import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCommands,
  readRecentCommands,
  rememberCommand,
  type Command as Cmd,
  type CommandContext,
} from "@/lib/manga/commands";
import { listProjects, type ProjectMeta } from "@/lib/manga/project";
import { cn } from "@/lib/utils";

const GROUP_ORDER = ["File", "Edit", "Insert", "Arrange", "View", "Pages", "Layouts", "Projects"];

/**
 * Spotlight matching: every word typed must start a word of the label or of
 * a keyword, so "go to" lists the pages and not every label with a g and an o.
 */
function matchCommand(value: string, search: string, keywords?: string[]) {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const label = value.toLowerCase();
  const hay = [label, ...(keywords ?? []).map((k) => k.toLowerCase())].join(" ");
  const words = hay.split(/[^\p{L}\p{N}+-]+/u).filter(Boolean);
  const terms = q.split(/\s+/);
  let score = 0;
  for (const t of terms) {
    if (label.startsWith(t)) score += 3;
    else if (words.some((w) => w.startsWith(t))) score += 2;
    else if (hay.includes(t)) score += 1;
    else return 0;
  }
  return score / (terms.length * 3);
}

/**
 * Spotlight for the studio: ⌘K opens a search field over the window, every
 * menubar verb plus the pages, layouts and saved projects are one keystroke
 * away, and the last few commands come back first.
 */
export function CommandPalette({
  open,
  onOpenChange,
  ctx,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: Omit<CommandContext, "projects">;
}) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const latest = useRef(ctx);
  latest.current = ctx;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecent(readRecentCommands());
    let live = true;
    void listProjects()
      .then((rows) => {
        if (live) setProjects(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  // Built when the palette opens: the state it reads cannot change under a modal.
  const commands = useMemo(
    () => (open ? buildCommands({ ...latest.current, projects }) : []),
    [open, projects],
  );
  const groups = useMemo(() => {
    const byGroup = new Map<string, Cmd[]>();
    for (const c of commands) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    // Enabled first inside a group, so a search that ties never leads with a grey row.
    return [...byGroup.entries()]
      .map(([name, cmds]) => [name, cmds.filter((c) => !c.disabled).concat(cmds.filter((c) => c.disabled))] as const)
      .sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [commands]);
  const recentCommands = useMemo(
    () =>
      recent
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Cmd => Boolean(c) && !c!.disabled),
    [recent, commands],
  );

  function choose(c: Cmd) {
    rememberCommand(c.id);
    onOpenChange(false);
    // After the dialog has handed focus back, so a command that opens a
    // sheet is not fighting the palette for it.
    window.setTimeout(() => c.run(), 0);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="koma-palette-scrim fixed inset-0 z-[140]" />
        <Dialog.Content
          data-koma-dialog="commands"
          aria-describedby={undefined}
          className="koma-palette koma-glass-surface fixed left-1/2 top-[14vh] z-[141] w-[min(37rem,calc(100%-1.5rem))] overflow-hidden rounded-[14px] shadow-float outline-none"
        >
          <Dialog.Title className="sr-only">Commands</Dialog.Title>
          <Command
            label="Commands"
            loop
            vimBindings={false}
            filter={matchCommand}
            className="flex max-h-[min(30rem,calc(100dvh-14vh-1.5rem))] flex-col"
          >
            <div className="flex h-[54px] shrink-0 items-center gap-3 px-4">
              <Search aria-hidden className="size-[22px] shrink-0 text-muted" strokeWidth={1.75} />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search commands, pages, layouts…"
                data-koma="command-input"
                className="h-full min-w-0 flex-1 bg-transparent text-[19px] font-normal leading-none text-ink outline-none placeholder:text-muted/70"
              />
              <kbd className="koma-kbd shrink-0 rounded-[4px] bg-ink/6 px-1.5 py-1">esc</kbd>
            </div>
            <div className="h-px shrink-0 bg-line" />
            <Command.List className="koma-palette-list min-h-0 overflow-y-auto overscroll-contain px-2 py-1.5">
              <Command.Empty className="px-3 py-9 text-center text-[13px] text-muted">
                No matching commands
              </Command.Empty>
              {query === "" && recentCommands.length ? (
                <Command.Group heading="Recent">
                  {recentCommands.map((c) => (
                    <Row key={`recent:${c.id}`} c={c} value={`recent:${c.label}`} trailing onSelect={choose} />
                  ))}
                </Command.Group>
              ) : null}
              {groups.map(([name, cmds]) => (
                <Command.Group key={name} heading={name}>
                  {cmds.map((c) => (
                    <Row key={c.id} c={c} value={c.label} onSelect={choose} />
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="h-px shrink-0 bg-line" />
            <div className="flex h-8 shrink-0 items-center gap-4 px-4 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <kbd className="koma-kbd rounded-[4px] bg-ink/6 px-1 py-0.5">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="koma-kbd rounded-[4px] bg-ink/6 px-1 py-0.5">↩</kbd> Run
              </span>
              <span className="ml-auto koma-keys tabular-nums">{ctx.apple ? "⌘K" : "Ctrl+K"}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({
  c,
  value,
  trailing,
  onSelect,
}: {
  c: Cmd;
  value: string;
  /** Show the command's group after the label (the Recent list mixes groups). */
  trailing?: boolean;
  onSelect: (c: Cmd) => void;
}) {
  return (
    <Command.Item
      value={value}
      keywords={c.keywords}
      disabled={c.disabled}
      onSelect={() => onSelect(c)}
      data-koma-command={c.id}
      className={cn(
        "koma-palette-item relative flex h-[30px] cursor-default select-none items-center rounded-[6px] pl-7 pr-2.5 text-[13px] text-ink",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-fg data-[disabled=true]:opacity-40",
      )}
    >
      {c.checked ? (
        <Check
          aria-hidden
          className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
          strokeWidth={2.5}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{c.label}</span>
      {trailing ? <span className="ml-3 shrink-0 text-[11px] opacity-55">{c.group}</span> : null}
      {c.keys ? (
        <span className="koma-keys ml-4 shrink-0 text-[12px] tabular-nums opacity-55">{c.keys}</span>
      ) : null}
    </Command.Item>
  );
}
