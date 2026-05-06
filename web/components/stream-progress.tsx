"use client";

import { cn } from "@/lib/utils";
import type { Tranche } from "@/lib/storage";

export function StreamProgress({
  tranches,
  block,
}: {
  tranches: Tranche[];
  block: number;
}) {
  const total = tranches.length;
  const claimed = tranches.filter((t) => t.status === "claimed").length;
  const cancelled = tranches.filter((t) => t.status === "cancelled").length;
  const unlocked = tranches.filter(
    (t) => t.status === "pending" && t.unlockBlock <= block,
  ).length;

  // Visual percentage = claimed / total (the only "really" recipient-owned
  // portion). Pending-unlocked is shown via the amber pulse below.
  const pct = total === 0 ? 0 : (claimed / total) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Tranches</span>
        <span className="text-foreground font-medium">
          {claimed}/{total} claimed
          {unlocked > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="text-amber-300">{unlocked} unlocked</span>
            </>
          )}
          {cancelled > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="text-rose-400">{cancelled} cancelled</span>
            </>
          )}
        </span>
      </div>

      {/* Continuous progress (claimed share) */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Tranche cells */}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {tranches.map((t) => (
          <div
            key={t.index}
            title={`#${t.index} amount=${t.amount} unlock@${t.unlockBlock} · ${t.status}`}
            className={cn(
              "h-2 rounded-sm transition-colors",
              cellColor(t, block),
            )}
          />
        ))}
      </div>
    </div>
  );
}

function cellColor(t: Tranche, block: number): string {
  if (t.status === "claimed") return "bg-emerald-500";
  if (t.status === "cancelled") return "bg-rose-700/80";
  if (t.unlockBlock <= block) return "bg-amber-400 shadow-[0_0_8px_-2px] shadow-amber-400/60";
  return "bg-muted";
}
