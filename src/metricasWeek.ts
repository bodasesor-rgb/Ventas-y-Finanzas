/**
 * Semana en curso, o la que cerró en los últimos 7 días.
 * Esas hay que reescribir: si no, el primer fill parcial se congela.
 */
export function weekIsLive_(weekStartMs: number, todayUtc: number): boolean {
  const weekEnd = weekStartMs + 7 * 86400000;
  return weekStartMs <= todayUtc && weekEnd > todayUtc - 7 * 86400000;
}

export function shouldWriteWeekCell_(opts: {
  weekStartMs: number;
  todayUtc: number;
  empty: boolean;
  force?: boolean;
}): boolean {
  if (opts.force || opts.empty) return true;
  return weekIsLive_(opts.weekStartMs, opts.todayUtc);
}
