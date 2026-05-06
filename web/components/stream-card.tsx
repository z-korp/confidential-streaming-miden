"use client";

import { ArrowDownToLine, Ban, ChevronRight, Coins, Hash, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { blocksToHuman } from "@/lib/time";
import type { Stream, TrancheStatus } from "@/lib/storage";
import { StreamProgress } from "./stream-progress";

type Status = "active" | "completed" | "cancelled";

function deriveStatus(s: Stream): Status {
  const counts = s.tranches.reduce(
    (acc, t) => {
      acc[t.status]++;
      return acc;
    },
    { pending: 0, claimed: 0, cancelled: 0 } as Record<TrancheStatus, number>,
  );
  if (counts.pending === 0 && counts.cancelled > 0 && counts.claimed === 0) {
    return "cancelled";
  }
  if (counts.pending === 0) return "completed";
  return "active";
}

const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  active: {
    label: "Active",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  completed: {
    label: "Completed",
    cls: "border-border bg-muted text-muted-foreground",
  },
  cancelled: {
    label: "Cancelled",
    cls: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  },
};

export function StreamCard({
  stream,
  block,
  busy,
  onClaim,
  onCancel,
  onOpen,
}: {
  stream: Stream;
  block: number;
  busy: string | null;
  onClaim: () => void;
  onCancel: () => void;
  onOpen?: () => void;
}) {
  const status = deriveStatus(stream);
  const claimedAmount = stream.tranches
    .filter((t) => t.status === "claimed")
    .reduce((acc, t) => acc + t.amount, 0);
  const lockedAmount = stream.tranches
    .filter((t) => t.status === "pending")
    .reduce((acc, t) => acc + t.amount, 0);

  const pendingUnlocked = stream.tranches.filter(
    (t) => t.status === "pending" && t.unlockBlock <= block,
  ).length;
  const claimable = stream.tranches
    .filter((t) => t.status === "pending" && t.unlockBlock <= block)
    .reduce((acc, t) => acc + t.amount, 0);

  const remainingPending = stream.tranches.filter((t) => t.status === "pending").length;
  const nextUnlock = stream.tranches
    .filter((t) => t.status === "pending")
    .map((t) => t.unlockBlock)
    .sort((a, b) => a - b)[0];

  const claimDisabled =
    busy !== null || pendingUnlocked === 0 || status === "cancelled";
  const cancelDisabled = busy !== null || remainingPending === 0;

  const nextUnlockEta =
    nextUnlock != null ? Math.max(0, nextUnlock - block) : null;

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group rounded-xl border border-border bg-card p-4 transition-colors",
        onOpen && "cursor-pointer hover:border-foreground/20 hover:bg-card/70",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            {stream.id}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px] uppercase tracking-wider",
              STATUS_BADGE[status].cls,
            )}
          >
            {STATUS_BADGE[status].label}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {nextUnlockEta != null && nextUnlockEta > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              next unlock ~{blocksToHuman(nextUnlockEta)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              block {block.toLocaleString()}
            </span>
          )}
          {onOpen && (
            <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Total"
          value={`${stream.total.toLocaleString()}`}
          unit="STREAM"
          tone="default"
        />
        <Stat
          label="Claimed"
          value={`${claimedAmount.toLocaleString()}`}
          unit="STREAM"
          tone="success"
        />
        <Stat
          label={remainingPending > 0 ? "Locked" : "—"}
          value={remainingPending > 0 ? `${lockedAmount.toLocaleString()}` : "0"}
          unit="STREAM"
          tone="muted"
          subtitle={
            remainingPending > 0 && nextUnlockEta != null
              ? nextUnlockEta > 0
                ? `next unlock in ~${blocksToHuman(nextUnlockEta)}`
                : "next unlock ready"
              : undefined
          }
        />
      </div>

      <div className="mt-4">
        <StreamProgress tranches={stream.tranches} block={block} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {pendingUnlocked > 0 ? (
            <span className="text-amber-300">
              {claimable.toLocaleString()} STREAM ready to claim
            </span>
          ) : status === "completed" ? (
            <span>Stream fully settled.</span>
          ) : status === "cancelled" ? (
            <span>Reclaimed by sender.</span>
          ) : (
            <span>Awaiting next unlock…</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="success"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onClaim();
            }}
            disabled={claimDisabled}
            title="Bob consumes any unlocked tranche notes"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            {busy === `claim:${stream.id}`
              ? "Claiming…"
              : `Claim${pendingUnlocked > 0 ? ` (${pendingUnlocked})` : ""}`}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            disabled={cancelDisabled}
            title="Alice reclaims all still-pending tranche notes"
          >
            <Ban className="h-3.5 w-3.5" />
            {busy === `cancel:${stream.id}` ? "Cancelling…" : "Cancel remaining"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
  subtitle,
}: {
  label: string;
  value: string;
  unit: string;
  tone: "default" | "success" | "muted";
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Coins className="h-3 w-3" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "success" && "text-emerald-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}{" "}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {unit}
        </span>
      </div>
      {subtitle && (
        <div className="mt-1 text-[10px] text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}
