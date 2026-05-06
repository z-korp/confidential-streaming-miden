"use client";

import { Cpu, Globe, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProverMode } from "@/lib/storage";

export function NetworkBar({
  block,
  proverMode,
  onChangeProver,
}: {
  block: number | null;
  proverMode: ProverMode;
  onChangeProver: (m: ProverMode) => void;
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <div className="flex items-center gap-3 px-1">
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Network
          </span>
          <span className="text-sm font-medium">Miden testnet</span>
        </div>
      </div>

      <div className="hidden h-8 w-px bg-border sm:block" />

      <div className="flex items-center gap-3 px-1">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Block
          </span>
          <span className="text-sm font-mono">
            {block != null ? block.toLocaleString() : "…"}
          </span>
        </div>
      </div>

      <div className="hidden h-8 w-px bg-border sm:block" />

      <div className="flex flex-1 items-center gap-2 sm:justify-end">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Prover
        </span>
        <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
          <ProverPill
            active={proverMode === "local"}
            onClick={() => onChangeProver("local")}
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="Local"
            hint="STARK in-browser · witness stays local"
          />
          <ProverPill
            active={proverMode === "testnet"}
            onClick={() => onChangeProver("testnet")}
            icon={<Server className="h-3.5 w-3.5" />}
            label="Remote"
            hint="Miden hosted prover · faster, witness leaves browser"
          />
        </div>
      </div>
    </div>
  );
}

function ProverPill({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
