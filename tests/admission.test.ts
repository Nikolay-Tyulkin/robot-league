import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionQueue, type AdmissionOptions, type AdmissionTicket } from '../server/admission.ts';

function fixture(options: AdmissionOptions = {}) {
  let time = 1000;
  const queue = new AdmissionQueue({ capacity: 2, waitingTtlMs: 100, offerTtlMs: 50, reconnectMs: 25, ...options, now: () => time });
  return { queue, advance: (ms: number) => { time += ms; }, now: () => time };
}

function join(queue: AdmissionQueue, visitor: string): AdmissionTicket {
  const ticket = queue.join(visitor);
  assert.ok(ticket);
  assert.match(ticket.ticket, /^[a-zA-Z0-9_-]{32}$/);
  return ticket;
}

void test('default admission admits 200 players and keeps further visitors in FIFO order', () => {
  const queue = new AdmissionQueue({ now: () => 1000 });
  const tickets = Array.from({ length: 203 }, (_, index) => join(queue, `visitor-${index}`));
  assert.equal(new Set(tickets.map(ticket => ticket.ticket)).size, tickets.length);
  assert.ok(tickets.slice(0, 200).every(ticket => ticket.status === 'ready' && ticket.position === 0));
  assert.deepEqual(tickets.slice(200).map(ticket => ticket.position), [1, 2, 3]);
  assert.deepEqual(queue.stats(), { admitted: 200, waiting: 3, capacity: 200 });
});

void test('join is idempotent in waiting, ready, connected, and disconnected states', () => {
  const { queue } = fixture({ capacity: 1 });
  const owner = join(queue, 'owner'), waiter = join(queue, 'waiter');
  assert.equal(join(queue, 'owner').ticket, owner.ticket);
  assert.equal(join(queue, 'waiter').ticket, waiter.ticket);
  assert.equal(queue.claim(owner.ticket), true);
  assert.equal(join(queue, 'owner').status, 'active');
  queue.disconnect(owner.ticket);
  assert.equal(join(queue, 'owner').ticket, owner.ticket);
  assert.deepEqual(queue.stats(), { admitted: 1, waiting: 1, capacity: 1 });
});

void test('cancellation updates positions and free capacity promotes the oldest surviving waiter', () => {
  const { queue } = fixture();
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(visitor => join(queue, visitor));
  queue.release(d.ticket);
  assert.equal(queue.poll(d.ticket), null);
  assert.equal(queue.poll(e.ticket)?.position, 2);
  queue.release(a.ticket);
  assert.equal(queue.poll(c.ticket)?.status, 'ready');
  assert.equal(queue.poll(e.ticket)?.position, 1);
  const late = join(queue, 'late');
  assert.equal(late.position, 2);
  queue.release(b.ticket);
  assert.equal(queue.poll(e.ticket)?.status, 'ready');
  assert.equal(queue.poll(late.ticket)?.position, 1);
  queue.release(a.ticket);
  queue.release('missing');
  assert.deepEqual(queue.stats(), { admitted: 2, waiting: 1, capacity: 2 });
});

void test('waiting poll renews its lease, but peek and expired-ticket polls cannot revive it', () => {
  const { queue, advance, now } = fixture({ capacity: 1 });
  const owner = join(queue, 'owner');
  queue.claim(owner.ticket);
  const waiting = join(queue, 'waiting');
  advance(75);
  assert.equal(queue.poll(waiting.ticket)?.expiresAt, now() + 100);
  advance(99);
  assert.equal(queue.peek(waiting.ticket)?.status, 'waiting');
  advance(1);
  assert.equal(queue.poll(waiting.ticket), null);
  assert.equal(queue.claim(waiting.ticket), false);
  assert.notEqual(join(queue, 'waiting').ticket, waiting.ticket);
});

void test('ready offers expire at a fixed deadline despite repeated polls or joins', () => {
  const { queue, advance } = fixture({ capacity: 1 });
  const ready = join(queue, 'ready'), first = join(queue, 'first'), second = join(queue, 'second');
  advance(49);
  assert.equal(queue.poll(ready.ticket)?.expiresAt, ready.expiresAt);
  assert.equal(join(queue, 'ready').expiresAt, ready.expiresAt);
  advance(1);
  assert.equal(queue.poll(ready.ticket), null);
  assert.equal(queue.claim(ready.ticket), false);
  assert.equal(queue.poll(first.ticket)?.status, 'ready');
  assert.equal(queue.poll(second.ticket)?.position, 1);
  assert.equal(join(queue, 'ready').position, 2);
  advance(50);
  assert.equal(queue.poll(first.ticket), null);
  assert.equal(queue.poll(second.ticket)?.status, 'ready');
});

void test('expired waiting entries are removed before capacity promotions', () => {
  const { queue, advance } = fixture({ capacity: 1, waitingTtlMs: 20 });
  const offered = join(queue, 'offered'), gone = join(queue, 'gone');
  advance(19);
  const live = join(queue, 'live');
  advance(19);
  queue.poll(live.ticket);
  advance(12);
  assert.equal(queue.poll(offered.ticket), null);
  assert.equal(queue.poll(gone.ticket), null);
  assert.equal(queue.poll(live.ticket)?.status, 'ready');
  assert.deepEqual(queue.stats(), { admitted: 1, waiting: 0, capacity: 1 });
});

void test('claim is single-use while connected; active transports never expire from inactivity', () => {
  const { queue, advance } = fixture({ capacity: 1 });
  const active = join(queue, 'active'), waiter = join(queue, 'waiter');
  assert.equal(queue.claim(waiter.ticket), false);
  assert.equal(queue.claim('missing'), false);
  assert.equal(queue.claim(active.ticket), true);
  assert.equal(queue.claim(active.ticket), false);
  advance(1000000);
  assert.deepEqual(queue.poll(active.ticket), { ticket: active.ticket, status: 'active', position: 0, expiresAt: null });
  assert.equal(queue.claim(active.ticket), false);
  assert.deepEqual(queue.stats(), { admitted: 1, waiting: 0, capacity: 1 });
});

void test('disconnect reserves capacity for its owner; polling and repeated disconnects cannot extend grace', () => {
  const { queue, advance, now } = fixture({ capacity: 1 });
  const owner = join(queue, 'owner'), waiter = join(queue, 'waiter');
  queue.claim(owner.ticket);
  queue.disconnect(owner.ticket);
  const deadline = now() + 25;
  assert.equal(queue.poll(owner.ticket)?.expiresAt, deadline);
  advance(24);
  queue.disconnect(owner.ticket);
  assert.equal(join(queue, 'owner').expiresAt, deadline);
  assert.equal(queue.poll(waiter.ticket)?.status, 'waiting');
  assert.equal(queue.claim(owner.ticket), true);
  assert.equal(queue.poll(owner.ticket)?.expiresAt, null);
  advance(50);
  assert.equal(queue.poll(owner.ticket)?.status, 'active');
  queue.disconnect(owner.ticket);
  advance(25);
  assert.equal(queue.poll(owner.ticket), null);
  assert.equal(queue.claim(owner.ticket), false);
  assert.equal(queue.poll(waiter.ticket)?.status, 'ready');
});

void test('disconnect ignores offers and waiting tickets; zero grace frees an active slot immediately', () => {
  const { queue } = fixture({ capacity: 1, reconnectMs: 0 });
  const owner = join(queue, 'owner'), waiter = join(queue, 'waiter');
  queue.disconnect(owner.ticket);
  queue.disconnect(waiter.ticket);
  assert.deepEqual(queue.peek(owner.ticket), owner);
  assert.equal(queue.peek(waiter.ticket)?.status, 'waiting');
  queue.claim(owner.ticket);
  queue.disconnect(owner.ticket);
  assert.equal(queue.peek(owner.ticket), null);
  assert.equal(queue.peek(waiter.ticket)?.status, 'ready');
});

void test('releasing connected and disconnected tickets frees their reservations permanently', () => {
  const { queue, advance } = fixture();
  const a = join(queue, 'a'), b = join(queue, 'b'), c = join(queue, 'c'), d = join(queue, 'd');
  queue.claim(a.ticket);
  queue.claim(b.ticket);
  queue.disconnect(b.ticket);
  queue.release(a.ticket);
  queue.release(b.ticket);
  assert.equal(queue.peek(c.ticket)?.status, 'ready');
  assert.equal(queue.peek(d.ticket)?.status, 'ready');
  assert.equal(queue.claim(a.ticket), false);
  assert.equal(queue.claim(b.ticket), false);
  advance(25);
  assert.deepEqual(queue.stats(), { admitted: 2, waiting: 0, capacity: 2 });
});

void test('waiting limit allows idempotent retries and rejects extra visitors without reserving them', () => {
  const { queue } = fixture({ capacity: 1, maxWaiting: 1 });
  const owner = join(queue, 'owner'), waiter = join(queue, 'waiter');
  assert.equal(queue.join('extra'), null);
  assert.equal(queue.join('waiter')?.ticket, waiter.ticket);
  queue.release(owner.ticket);
  assert.equal(join(queue, 'extra').position, 1);
  const none = fixture({ capacity: 1, maxWaiting: 0 }).queue;
  join(none, 'owner');
  assert.equal(none.join('extra'), null);
});

void test('lease heap handles renewals and removals in a different order from arrival', () => {
  const { queue, advance } = fixture({ capacity: 1 });
  const owner = join(queue, 'owner');
  queue.claim(owner.ticket);
  const tickets = Array.from({ length: 30 }, (_, i) => join(queue, `visitor-${i}`));
  advance(10);
  for (let i = 29; i >= 0; i -= 2) queue.poll(tickets[i].ticket);
  advance(10);
  for (let i = 0; i < 30; i += 3) queue.release(tickets[i].ticket);
  advance(80);
  const remaining = tickets.filter((_, i) => i % 2 === 1 && i % 3 !== 0);
  assert.equal(queue.stats().waiting, remaining.length);
  remaining.forEach((ticket, i) => assert.equal(queue.peek(ticket.ticket)?.position, i + 1));
  advance(10);
  assert.equal(queue.stats().waiting, 0);
  queue.release(owner.ticket);
  assert.equal(queue.stats().admitted, 0);
});

void test('10,000 waiting positions stay exact through cancellation, append and rank-index compaction', () => {
  const { queue } = fixture({ capacity: 1, maxWaiting: 10000 });
  const owner = join(queue, 'owner');
  queue.claim(owner.ticket);
  const tickets = Array.from({ length: 10000 }, (_, i) => join(queue, `visitor-${i}`));
  assert.equal(queue.join('overflow'), null);
  assert.equal(queue.poll(tickets[9999].ticket)?.position, 10000);
  const survivors = tickets.filter((ticket, i) => {
    if (i % 2 === 0) { queue.release(ticket.ticket); return false; }
    return true;
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    const transient = Array.from({ length: 5000 }, (_, i) => join(queue, `transient-${cycle}-${i}`));
    assert.equal(queue.poll(transient[4999].ticket)?.position, 10000);
    survivors.forEach((ticket, i) => assert.equal(queue.poll(ticket.ticket)?.position, i + 1));
    transient.forEach(ticket => queue.release(ticket.ticket));
  }
  queue.release(owner.ticket);
  assert.equal(queue.poll(survivors[0].ticket)?.status, 'ready');
  assert.equal(queue.poll(survivors[4999].ticket)?.position, 4999);
  assert.deepEqual(queue.stats(), { admitted: 1, waiting: 4999, capacity: 1 });
});

void test('invalid limits and durations are rejected before allocating queue storage', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ['capacity', 'maxWaiting', 'waitingTtlMs', 'offerTtlMs', 'reconnectMs'] as const) {
      assert.throws(() => new AdmissionQueue({ [key]: value }), RangeError, `${key}: ${value}`);
    }
  }
  for (const key of ['capacity', 'waitingTtlMs', 'offerTtlMs'] as const) assert.throws(() => new AdmissionQueue({ [key]: 0 }), RangeError);
  assert.throws(() => new AdmissionQueue({ maxWaiting: 1000001 }), RangeError);
  assert.throws(() => new AdmissionQueue().join(''), RangeError);
  assert.throws(() => new AdmissionQueue().join('x'.repeat(257)), RangeError);
});
