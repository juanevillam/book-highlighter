/**
 * THE LIBRARY'S ORDER — a fractional index, so a move writes ONE document
 * (or one series's documents). Mirrors `sound-shaper/src/lib/gridOrder.ts`.
 */

export const POSITION_STEP = 1;

export const positionBetween = (
  prev: number | null,
  next: number | null,
): number | null => {
  if (prev === null && next === null) return 0;
  if (prev === null) return (next as number) - POSITION_STEP;
  if (next === null) return prev + POSITION_STEP;

  if (prev >= next) return null;

  const middle = prev + (next - prev) / 2;

  return middle > prev && middle < next ? middle : null;
};

export const renormalized = <T extends { id: string }>(
  ordered: T[],
): Array<{ id: string; position: number }> =>
  ordered.map((entry, index) => ({
    id: entry.id,
    position: index * POSITION_STEP,
  }));

export const positionForMove = (
  ordered: Array<{ position: number | null }>,
  toIndex: number,
): number | null => {
  const before = ordered[toIndex - 1]?.position ?? null;
  const after = ordered[toIndex + 1]?.position ?? null;

  return positionBetween(before, after);
};

export const byGridOrder = <
  T extends { createdAt: number | null; position: number | null },
>(
  entries: T[],
): T[] =>
  [...entries].sort((a, b) => {
    if (a.position !== null && b.position !== null) {
      return a.position - b.position;
    }
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;

    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });

export const needsPositionRepair = (
  entries: Array<{ position: number | null }>,
): boolean => {
  const seen = new Set<number>();

  for (const entry of entries) {
    if (entry.position === null) return true;
    if (seen.has(entry.position)) return true;
    seen.add(entry.position);
  }

  return false;
};
