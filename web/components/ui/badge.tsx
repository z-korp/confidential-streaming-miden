import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "destructive" | "success";

const VARIANTS: Record<Variant, string> = {
  default: "border-transparent bg-foreground text-background",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "text-foreground border-border",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
