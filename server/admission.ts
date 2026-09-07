import { randomBytes } from 'node:crypto';

export type AdmissionTicket = {
  ticket: string;
  /** Waiting positions are one-based; ready and active tickets have position zero. */
  position: number;
} & (
  | { status: 'waiting' | 'ready'; expiresAt: number }
  | { status: 'active'; expiresAt: number | null }
);

export type AdmissionOptions = {
  capacity?: number;
  maxWaiting?: number;
  waitingTtlMs?: number;
  offerTtlMs?: number;
  reconnectMs?: number;
  now?: () => number;
};

type Entry = {
  ticket: string;
  visitorId: string;
  status: 'waiting' | 'ready' | 'active';
  expiresAt: number | null;
  queueIndex: number;
  heapIndex: number;
};

/**
 * Process-local FIFO multiplayer admission. Offers and disconnected players reserve
 * capacity; connected players have no expiry. Only waiting polls renew a lease.
 * Ticket lookups are constant-time, and queue ranks/lease updates are logarithmic.
 */
export class AdmissionQueue {
  private readonly capacity: number;
  private readonly maxWaiting: number;
  private readonly waitingTtlMs: number;
  private readonly offerTtlMs: number;
  private readonly reconnectMs: number;
  private readonly now: () => number;
  private readonly tickets = new Map<string, Entry>();
  private readonly visitors = new Map<string, Entry>();
  private readonly waiting = new Map<string, Entry>();
  private readonly expirations: Entry[] = [];
  private readonly ranks: Uint32Array;
  private queueTail = 0;
  private admitted = 0;

  constructor(options: AdmissionOptions = {}) {
    this.capacity = integerOption('capacity', options.capacity ?? 200, 1);
    // Bound the fixed rank index allocation as well as the number of live tickets.
    this.maxWaiting = integerOption('maxWaiting', options.maxWaiting ?? 10000, 0, 1000000);
    this.waitingTtlMs = integerOption('waitingTtlMs', options.waitingTtlMs ?? 30000, 1);
    this.offerTtlMs = integerOption('offerTtlMs', options.offerTtlMs ?? 15000, 1);
    this.reconnectMs = integerOption('reconnectMs', options.reconnectMs ?? 15000, 0);
    this.now = options.now ?? Date.now;
    this.ranks = new Uint32Array(Math.max(2, this.maxWaiting * 2 + 1));
  }

  join(visitorId: string): AdmissionTicket | null {
    if (!visitorId || visitorId.length > 256) throw new RangeError('Invalid visitor ID');
    const now = this.now();
    this.expireAndPromote(now);
    const existing = this.visitors.get(visitorId);
    if (existing) {
      if (existing.status === 'waiting') this.setDeadline(existing, now + this.waitingTtlMs);
      return this.snapshot(existing);
    }
    if (this.admitted >= this.capacity && this.waiting.size >= this.maxWaiting) return null;
    let ticket: string;
    do { ticket = randomBytes(24).toString('base64url'); } while (this.tickets.has(ticket));
    const entry: Entry = {
      ticket, visitorId, status: this.admitted < this.capacity ? 'ready' : 'waiting',
      expiresAt: null, queueIndex: 0, heapIndex: -1,
    };
    this.tickets.set(ticket, entry);
    this.visitors.set(visitorId, entry);
    if (entry.status === 'waiting') {
      this.enqueue(entry);
      this.setDeadline(entry, now + this.waitingTtlMs);
    } else {
      this.admitted++;
      this.setDeadline(entry, now + this.offerTtlMs);
    }
    return this.snapshot(entry);
  }

  poll(ticket: string): AdmissionTicket | null {
    const now = this.now();
    this.expireAndPromote(now);
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    if (entry.status === 'waiting') this.setDeadline(entry, now + this.waitingTtlMs);
    return this.snapshot(entry);
  }

  /** Inspect a ticket without renewing its waiting or reconnect lease. */
  peek(ticket: string): AdmissionTicket | null {
    this.sweep();
    const entry = this.tickets.get(ticket);
    return entry ? this.snapshot(entry) : null;
  }

  /** Claim once for a live transport, or reclaim an owner's disconnected slot. */
  claim(ticket: string): boolean {
    this.sweep();
    const entry = this.tickets.get(ticket);
    if (!entry || entry.status === 'waiting' || (entry.status === 'active' && entry.expiresAt === null)) return false;
    entry.status = 'active';
    this.setDeadline(entry, null);
    return true;
  }

  disconnect(ticket: string): void {
    const now = this.now();
    this.expireAndPromote(now);
    const entry = this.tickets.get(ticket);
    if (entry?.status !== 'active' || entry.expiresAt !== null) return;
    this.setDeadline(entry, now + this.reconnectMs);
    if (this.reconnectMs === 0) this.expireAndPromote(now);
  }

  release(ticket: string): void {
    const now = this.now();
    this.expireAndPromote(now);
    const entry = this.tickets.get(ticket);
    if (entry) this.remove(entry);
    this.promote(now);
  }

  sweep(): void {
    this.expireAndPromote(this.now());
  }

  stats(): { admitted: number; waiting: number; capacity: number } {
    this.sweep();
    return { admitted: this.admitted, waiting: this.waiting.size, capacity: this.capacity };
  }

  private snapshot(entry: Entry): AdmissionTicket {
    const position = entry.status === 'waiting' ? this.rank(entry.queueIndex) : 0;
    if (entry.status === 'active') return { ticket: entry.ticket, status: entry.status, position, expiresAt: entry.expiresAt };
    return { ticket: entry.ticket, status: entry.status, position, expiresAt: entry.expiresAt! };
  }

  private expireAndPromote(now: number): void {
    while (this.expirations.length && this.expirations[0].expiresAt! <= now) this.remove(this.expirations[0]);
    this.promote(now);
  }

  private promote(now: number): void {
    while (this.admitted < this.capacity && this.waiting.size) {
      const entry = this.waiting.values().next().value!;
      this.dequeue(entry);
      entry.status = 'ready';
      this.admitted++;
      this.setDeadline(entry, now + this.offerTtlMs);
    }
  }

  private remove(entry: Entry): void {
    this.removeDeadline(entry);
    this.tickets.delete(entry.ticket);
    this.visitors.delete(entry.visitorId);
    if (entry.status === 'waiting') this.dequeue(entry);
    else this.admitted--;
  }

  private enqueue(entry: Entry): void {
    if (this.queueTail + 1 >= this.ranks.length) {
      // Compact at most once per maxWaiting additions, keeping ranks and memory
      // bounded even when the oldest visitor stays while later visitors cancel.
      this.ranks.fill(0);
      this.queueTail = 0;
      for (const waiter of this.waiting.values()) {
        waiter.queueIndex = ++this.queueTail;
        this.addRank(waiter.queueIndex, 1);
      }
    }
    entry.queueIndex = ++this.queueTail;
    this.waiting.set(entry.ticket, entry);
    this.addRank(entry.queueIndex, 1);
  }

  private dequeue(entry: Entry): void {
    this.waiting.delete(entry.ticket);
    this.addRank(entry.queueIndex, -1);
    entry.queueIndex = 0;
    if (!this.waiting.size) this.queueTail = 0;
  }

  private addRank(index: number, change: number): void {
    for (let i = index; i < this.ranks.length; i += i & -i) this.ranks[i] += change;
  }

  private rank(index: number): number {
    let result = 0;
    for (let i = index; i > 0; i -= i & -i) result += this.ranks[i];
    return result;
  }

  // The indexed heap contains at most one deadline per expiring ticket; polling
  // updates it in place instead of accumulating stale expiry records.
  private setDeadline(entry: Entry, deadline: number | null): void {
    entry.expiresAt = deadline;
    if (deadline === null) { this.removeDeadline(entry); return; }
    if (entry.heapIndex < 0) {
      entry.heapIndex = this.expirations.length;
      this.expirations.push(entry);
    }
    this.fixDeadline(entry.heapIndex);
  }

  private removeDeadline(entry: Entry): void {
    const index = entry.heapIndex;
    if (index < 0) return;
    const last = this.expirations.pop()!;
    entry.heapIndex = -1;
    if (index < this.expirations.length) {
      this.expirations[index] = last;
      last.heapIndex = index;
      this.fixDeadline(index);
    }
  }

  private fixDeadline(index: number): void {
    const heap = this.expirations;
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >> 1;
      if (heap[parent].expiresAt! <= heap[current].expiresAt!) break;
      this.swapDeadlines(current, parent);
      current = parent;
    }
    if (current !== index) return;
    while (current * 2 + 1 < heap.length) {
      let child = current * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].expiresAt! < heap[child].expiresAt!) child++;
      if (heap[current].expiresAt! <= heap[child].expiresAt!) break;
      this.swapDeadlines(current, child);
      current = child;
    }
  }

  private swapDeadlines(a: number, b: number): void {
    const heap = this.expirations;
    [heap[a], heap[b]] = [heap[b], heap[a]];
    heap[a].heapIndex = a;
    heap[b].heapIndex = b;
  }
}

function integerOption(name: string, value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}
