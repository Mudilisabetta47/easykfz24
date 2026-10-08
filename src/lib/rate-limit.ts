// Gleitendes Zeitfenster je Schlüssel (z. B. IP). Speicher im Prozess – für eine Instanz ausreichend.

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  private result(list: number[]): LimitResult {
    const remaining = Math.max(0, this.limit - list.length);
    const retryAfterMs = remaining > 0 ? 0 : list[0] + this.windowMs - this.now();
    return { allowed: remaining > 0, remaining, retryAfterMs };
  }

  /** Prüft, ohne zu zählen. */
  check(key: string): LimitResult {
    return this.result(this.recent(key));
  }

  /** Zählt einen Versuch, sofern noch erlaubt. */
  hit(key: string): LimitResult {
    const list = this.recent(key);
    if (list.length >= this.limit) return this.result(list);
    list.push(this.now());
    this.hits.set(key, list);
    return { ...this.result(list), allowed: true };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Entfernt abgelaufene Einträge (gegen Speicherwachstum). */
  prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

export function formatRetryAfter(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes === 1 ? 'einer Minute' : `${minutes} Minuten`;
}
