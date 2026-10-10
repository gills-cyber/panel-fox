import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[opacity,transform,background-color,color,box-shadow] duration-[var(--motion-quick)] ease-[var(--ease-out)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent/90",
        hanko: "bg-accent text-accent-fg hover:bg-accent/90",
        outline:
          "bg-surface text-ink shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_1px_1px_rgb(0_0_0/0.06)] hover:bg-paper-shadow active:bg-ink/8 dark:bg-ink/10 dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.14)] dark:hover:bg-ink/15",
        ghost: "text-ink hover:bg-ink/5",
        muted: "bg-ink/5 text-ink hover:bg-ink/10",
      },
      size: {
        default: "h-10 px-3.5",
        sm: "h-7 rounded-[6px] px-3 text-[13px] [&_svg]:size-3.5",
        lg: "h-11 px-5",
        icon: "size-10",
        "icon-sm": "size-8 rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
