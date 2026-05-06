"use client";

import { Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ActivityLog({
  log,
  onClear,
}: {
  log: string[];
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Activity log</CardTitle>
          <span className="text-xs text-muted-foreground">
            {log.length} {log.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={log.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3">
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Run setup to start emitting events.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-xs leading-relaxed">
              {log.map((line, i) => (
                <LogLine key={i} line={line} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogLine({ line }: { line: string }) {
  const tone = lineTone(line);
  const tsMatch = line.match(/^(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)\s\s?(.*)$/);
  const ts = tsMatch?.[1] ?? "";
  const rest = tsMatch?.[2] ?? line;

  return (
    <li
      className={cn(
        "flex items-start gap-2 whitespace-pre-wrap break-words",
        tone === "error" && "text-rose-400",
        tone === "success" && "text-emerald-400",
        tone === "info" && "text-foreground/90",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {ts && <span className="shrink-0 text-muted-foreground">{ts}</span>}
      <span>{rest}</span>
    </li>
  );
}

function lineTone(s: string): "error" | "success" | "info" | "muted" {
  const lower = s.toLowerCase();
  if (
    lower.includes("failed") ||
    lower.includes("error") ||
    lower.includes("aborted")
  )
    return "error";
  if (lower.includes(" done") || lower.includes("setup complete") || lower.includes("opened"))
    return "success";
  if (lower.includes("starting") || lower.includes("creating") || lower.includes("opening"))
    return "info";
  return "muted";
}
