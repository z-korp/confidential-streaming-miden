"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ModalShell({
  children,
  onClose,
  maxWidthClassName = "max-w-[1500px]",
}: {
  children: ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const stop = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-sm sm:px-6 sm:py-8"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full rounded-xl border border-border bg-background shadow-lg",
          maxWidthClassName,
        )}
        onClick={stop}
      >
        {children}
      </div>
    </div>
  );
}
