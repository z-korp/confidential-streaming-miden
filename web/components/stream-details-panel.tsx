"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDownToLine,
  Ban,
  CalendarCheck,
  ChevronLeft,
  Clock,
  Hash,
  LayoutGrid,
  Lock,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModalShell } from "./modal-shell";
import { cn } from "@/lib/utils";
import { blocksToHuman, estimateBlockClock, formatClock } from "@/lib/time";
import type { Stream, TrancheStatus } from "@/lib/storage";

const StoneStream = dynamic(() => import("@/components/stone-stream"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
      Loading visualization…
    </div>
  ),
});

type Props = {
  stream: Stream;
  block: number;
  busy: string | null;
  onClaim: () => void;
  onCancel: () => void;
  onBack: () => void;
};

export function StreamDetailsPanel({
  stream,
  block,
  busy,
  onClaim,
  onCancel,
  onBack,
}: Props) {
  const [animateClaim, setAnimateClaim] = useState(false);
  const wasBusyClaim = useBusyTransition(busy, `claim:${stream.id}`);
  useEffect(() => {
    if (wasBusyClaim) setAnimateClaim(true);
  }, [wasBusyClaim]);

  const counts = useMemo(() => countTranches(stream, block), [stream, block]);
  const status = deriveStatus(stream);

  const claimedPercent =
    counts.totalAmount > 0
      ? (counts.claimedAmount / counts.totalAmount) * 100
      : 0;
  const unlockedPercent =
    counts.totalAmount > 0
      ? (counts.unlockedAmount / counts.totalAmount) * 100
      : 0;

  const canClaim = counts.unlockedTranches > 0 && busy === null;
  const canCancel = counts.pendingTranches > 0 && busy === null;

  return (
    <ModalShell onClose={onBack} maxWidthClassName="max-w-6xl">
      <section className="max-h-[calc(100vh-3rem)] overflow-y-auto px-5 py-7 sm:px-7 sm:py-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={onBack}
              className="h-10 w-10 rounded-full"
              aria-label="Close stream details"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Stream
              </p>
              <h3 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                <Hash className="h-6 w-6 text-muted-foreground" />
                <span className="font-mono text-2xl sm:text-3xl">
                  {stream.id}
                </span>
              </h3>
            </div>
            <div className="ml-auto">
              <StatusPill status={status} />
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_500px]">
            {/* Left: stone + metrics + actions */}
            <div className="rounded-xl border border-border bg-card p-5 sm:p-8">
              <div className="h-[420px] w-full">
                <StoneStream
                  claimedPercent={claimedPercent}
                  unlockedPercent={unlockedPercent}
                  animateClaim={animateClaim}
                  onClaimComplete={() => setAnimateClaim(false)}
                />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <MetricPill
                  label="Available now"
                  value={`${counts.unlockedAmount.toLocaleString()} STREAM`}
                  tone="amber"
                />
                <MetricPill
                  label="Claimed"
                  value={`${counts.claimedAmount.toLocaleString()} STREAM`}
                  tone="emerald"
                />
                <MetricPill
                  label="Time left"
                  value={
                    counts.pendingTranches === 0
                      ? "—"
                      : `~${blocksToHuman(maxPendingDelta(stream, block))}`
                  }
                  tone="muted"
                />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  variant="success"
                  onClick={onClaim}
                  disabled={!canClaim}
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  {busy === `claim:${stream.id}`
                    ? "Claiming…"
                    : `Claim${counts.unlockedTranches > 0 ? ` (${counts.unlockedTranches})` : ""}`}
                </Button>
                <Button
                  variant="destructive"
                  onClick={onCancel}
                  disabled={!canCancel}
                >
                  <Ban className="h-4 w-4" />
                  {busy === `cancel:${stream.id}`
                    ? "Cancelling…"
                    : "Cancel remaining"}
                </Button>
                {!canClaim && !canCancel && (
                  <span className="inline-flex items-center rounded-full border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground">
                    Stream view-only.
                  </span>
                )}
              </div>
            </div>

            {/* Right: attributes */}
            <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="rounded-lg border border-border bg-secondary p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xl font-semibold">Attributes</h4>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {counts.totalTranches} tranches
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Attr
                    icon={LayoutGrid}
                    label="Shape"
                    value="Tranched · P2IDE"
                  />
                  <Attr icon={TrendingUp} label="Status" value={prettyStatus(status)} />
                  <Attr
                    icon={Wallet}
                    label="Total"
                    value={`${stream.total.toLocaleString()} STREAM`}
                  />
                  <Attr
                    icon={Lock}
                    label="Locked"
                    value={`${counts.lockedAmount.toLocaleString()} STREAM`}
                  />
                  <Attr
                    icon={Clock}
                    label="Started"
                    value={`block ${stream.createdAtBlock.toLocaleString()}`}
                  />
                  <Attr
                    icon={CalendarCheck}
                    label="Duration"
                    value={`~${blocksToHuman(stream.durationBlocks)} (${stream.durationBlocks} blocks)`}
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Meter
                    label="Claimed"
                    value={`${counts.claimedAmount.toLocaleString()} STREAM`}
                    percent={claimedPercent}
                    accent="bg-emerald-500"
                  />
                  <Meter
                    label="Unlocked"
                    value={`${counts.unlockedAmount.toLocaleString()} STREAM`}
                    percent={unlockedPercent}
                    accent="bg-amber-400"
                  />
                </div>

                <div className="mt-5">
                  <h5 className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>Tranches</span>
                    {counts.cancelledTranches > 0 && (
                      <span className="text-rose-400">
                        {counts.cancelledTranches} reclaimed
                      </span>
                    )}
                  </h5>
                  <div className="grid gap-1.5">
                    {stream.tranches.map((t) => {
                      const unlocked =
                        t.status === "pending" && t.unlockBlock <= block;
                      const blocksUntil = t.unlockBlock - block;
                      const eta =
                        blocksUntil > 0
                          ? formatClock(estimateBlockClock(t.unlockBlock, block))
                          : null;
                      return (
                        <div
                          key={t.index}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                            t.status === "claimed" &&
                              "border-emerald-500/30 bg-emerald-500/5",
                            t.status === "cancelled" &&
                              "border-rose-500/30 bg-rose-500/5",
                            t.status === "pending" && unlocked &&
                              "border-amber-500/40 bg-amber-500/5",
                            t.status === "pending" && !unlocked &&
                              "border-border bg-muted/30",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-block h-2 w-2 rounded-full",
                                t.status === "claimed" && "bg-emerald-500",
                                t.status === "cancelled" && "bg-rose-500",
                                t.status === "pending" && unlocked &&
                                  "bg-amber-400",
                                t.status === "pending" && !unlocked &&
                                  "bg-muted-foreground",
                              )}
                            />
                            <span className="font-mono text-muted-foreground">
                              #{t.index}
                            </span>
                            <span className="font-mono tabular-nums">
                              {t.amount.toLocaleString()} STREAM
                            </span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                            {t.status === "pending" && !unlocked && eta && (
                              <span title={`unlock @ block ${t.unlockBlock.toLocaleString()}`}>
                                ~{eta}
                              </span>
                            )}
                            {t.status === "pending" && (
                              <span
                                className={cn(
                                  "rounded-sm px-1.5 py-0.5",
                                  unlocked
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {unlocked
                                  ? "ready"
                                  : `~${blocksToHuman(blocksUntil)}`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </ModalShell>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "emerald" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-mono text-sm font-medium tabular-nums",
          tone === "amber" && "text-amber-300",
          tone === "emerald" && "text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Attr({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary p-4">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  percent,
  accent,
}: {
  label: string;
  value: string;
  percent: number;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="text-sm font-medium">{Math.round(percent)}%</span>
      </div>
      <p className="mt-3 font-mono text-base font-semibold tabular-nums">
        {value}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", accent)}
          style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
        />
      </div>
    </div>
  );
}

type Status = "active" | "completed" | "cancelled";

function deriveStatus(s: Stream): Status {
  const counts = s.tranches.reduce(
    (acc, t) => ((acc[t.status]++, acc)),
    { pending: 0, claimed: 0, cancelled: 0 } as Record<TrancheStatus, number>,
  );
  if (counts.pending === 0 && counts.cancelled > 0 && counts.claimed === 0) {
    return "cancelled";
  }
  if (counts.pending === 0) return "completed";
  return "active";
}

function prettyStatus(s: Status): string {
  return s === "active" ? "Active" : s === "completed" ? "Completed" : "Cancelled";
}

function StatusPill({ status }: { status: Status }) {
  const cls =
    status === "active"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : status === "completed"
        ? "border-border bg-muted text-muted-foreground"
        : "border-rose-500/30 bg-rose-500/10 text-rose-400";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
        cls,
      )}
    >
      {prettyStatus(status)}
    </span>
  );
}

function maxPendingDelta(s: Stream, block: number): number {
  let max = 0;
  for (const t of s.tranches) {
    if (t.status === "pending") {
      const d = Math.max(0, t.unlockBlock - block);
      if (d > max) max = d;
    }
  }
  return max;
}

function countTranches(s: Stream, block: number) {
  let claimedAmount = 0;
  let unlockedAmount = 0;
  let lockedAmount = 0;
  let cancelledAmount = 0;
  let pendingTranches = 0;
  let unlockedTranches = 0;
  let cancelledTranches = 0;

  for (const t of s.tranches) {
    if (t.status === "claimed") claimedAmount += t.amount;
    else if (t.status === "cancelled") {
      cancelledAmount += t.amount;
      cancelledTranches++;
    } else {
      pendingTranches++;
      if (t.unlockBlock <= block) {
        unlockedAmount += t.amount;
        unlockedTranches++;
      } else {
        lockedAmount += t.amount;
      }
    }
  }

  // Cancelled tranches no longer belong to the stream — exclude from the
  // "stone" denominator so the user sees progress on what remains.
  const totalAmount = s.total - cancelledAmount;

  return {
    claimedAmount,
    unlockedAmount,
    lockedAmount,
    cancelledAmount,
    totalAmount,
    pendingTranches,
    unlockedTranches,
    cancelledTranches,
    totalTranches: s.tranches.length,
  };
}

// Tracks transitions in `busy` so we can fire claim animation when the
// claim transaction completes (busy goes from "claim:X" → null).
function useBusyTransition(busy: string | null, watchKey: string): boolean {
  const [completed, setCompleted] = useState(false);
  const prev = useRef(busy);
  useEffect(() => {
    if (prev.current === watchKey && busy === null) {
      setCompleted(true);
      const t = setTimeout(() => setCompleted(false), 100);
      return () => clearTimeout(t);
    }
    prev.current = busy;
  }, [busy, watchKey]);
  return completed;
}
