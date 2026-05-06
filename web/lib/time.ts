// Miden testnet block-time helpers.
//
// Block production on testnet currently averages ~5 s. It's not strictly
// constant — RPC backpressure, sync gaps, etc. — so all conversions here are
// presented as estimates (prefix `~`).

export const BLOCK_SECONDS = 5;

/** Human-readable duration for a block delta. Examples: "12s", "3m 20s", "~1h 4m". */
export function blocksToHuman(blocks: number): string {
  if (!Number.isFinite(blocks)) return "—";
  const sec = Math.max(0, Math.round(blocks * BLOCK_SECONDS));
  return secondsToHuman(sec);
}

export function secondsToHuman(sec: number): string {
  if (sec < 1) return "now";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
}

/** Best-effort wall-clock estimate for a future block, given the current block. */
export function estimateBlockClock(
  targetBlock: number,
  currentBlock: number,
  now: Date = new Date(),
): Date {
  const delta = targetBlock - currentBlock;
  return new Date(now.getTime() + delta * BLOCK_SECONDS * 1000);
}

export function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
