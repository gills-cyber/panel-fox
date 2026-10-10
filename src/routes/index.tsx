import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Studio } from "@/components/manga/studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <TooltipProvider delayDuration={700} disableHoverableContent skipDelayDuration={300}>
      <Studio />
      <Toaster
        position="bottom-center"
        offset={28}
        duration={2200}
        gap={8}
        visibleToasts={2}
        toastOptions={{
          className: "koma-toast font-sans pointer-events-auto",
        }}
      />
    </TooltipProvider>
  );
}
