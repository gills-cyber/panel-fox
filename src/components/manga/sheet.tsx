import * as Dialog from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A macOS document sheet: it drops from under the toolbar, the window dims
 * but stays sharp, Esc cancels, Return triggers the default button, and
 * focus stays inside (Radix Dialog does the trapping and the a11y wiring).
 */
export function Sheet({
  open,
  onOpenChange,
  koma,
  className,
  children,
  ...content
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** data-koma-dialog value; also what the hotkey guard looks for. */
  koma: string;
  className?: string;
  children: ReactNode;
} & Pick<
  ComponentProps<typeof Dialog.Content>,
  "onOpenAutoFocus" | "onEscapeKeyDown" | "aria-labelledby" | "aria-describedby"
>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="koma-sheet-scrim fixed inset-0 z-[140]" />
        <Dialog.Content
          data-koma-dialog={koma}
          aria-describedby={undefined}
          {...content}
          className={cn(
            "koma-sheet koma-glass-surface fixed z-[141] w-[calc(100%-1.5rem)] rounded-[12px] p-5 shadow-float outline-none",
            className,
          )}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetTitle = Dialog.Title;
