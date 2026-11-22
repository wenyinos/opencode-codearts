// Bounded concurrency gate for upstream chat turns.
//
// CodeArts allows 3 concurrent sessions per account and answers the fourth
// with HTTP 400 `TM.00001041` ("并发会话数已达上限(3个)"). opencode can easily
// exceed that on its own: the main turn, title generation and subagent turns
// may run at the same time. Turns therefore queue here instead of reaching the
// gateway concurrently.
//
// The queue is bounded: an unbounded queue looks like "the client hangs" once
// a burst arrives, while a 429 lets the caller back off and retry. A queued
// turn additionally waits out a small cooldown before it starts, giving the
// gateway time to release the previous session slot.
import { log } from "./config.js";
export class ConcurrencyGate {
    limit;
    cooldownMs;
    maxQueue;
    active = 0;
    waiters = [];
    constructor(limit, cooldownMs = 0, maxQueue = Number.POSITIVE_INFINITY) {
        this.limit = Math.max(1, Math.floor(limit));
        this.cooldownMs = Math.max(0, cooldownMs);
        this.maxQueue = Math.max(0, Math.floor(maxQueue));
    }
    /**
     * Take a slot or wait for one. `admitted` means the caller owes exactly one
     * `release()`; `abandoned` means the signal aborted while queued (no slot was
     * taken, nothing is owed); `queue-full` means the request was refused.
     */
    async acquire(label, signal) {
        if (signal?.aborted)
            return "abandoned";
        if (this.active < this.limit) {
            this.active++;
            return "admitted";
        }
        if (this.waiters.length >= this.maxQueue) {
            log.warn(`queue full (${this.waiters.length} waiting), refusing ${label}`);
            return "queue-full";
        }
        log.debug(`queued ${label} (all ${this.limit} upstream slot(s) busy, ${this.waiters.length} ahead)`);
        return new Promise((resolve) => {
            const waiter = {
                label,
                resolve,
                enqueuedAt: Date.now(),
                granted: false,
                timer: null,
                detach: () => { },
            };
            if (signal) {
                const onAbort = () => this.cancel(waiter);
                signal.addEventListener("abort", onAbort, { once: true });
                waiter.detach = () => signal.removeEventListener("abort", onAbort);
            }
            this.waiters.push(waiter);
        });
    }
    release() {
        const next = this.waiters.shift();
        if (!next) {
            this.active--;
            return;
        }
        // The freed slot moves straight to the next waiter — still counted as
        // active, so a request arriving during the cooldown queues behind it
        // instead of stealing the slot that was already promised.
        next.granted = true;
        const admit = () => {
            next.timer = null;
            next.detach();
            log.debug(`admitted ${next.label} after ${Date.now() - next.enqueuedAt}ms ` +
                `(${this.waiters.length} still queued)`);
            next.resolve("admitted");
        };
        if (this.cooldownMs > 0) {
            log.debug(`cooling down ${this.cooldownMs}ms before admitting the next queued request`);
            next.timer = setTimeout(admit, this.cooldownMs);
        }
        else {
            admit();
        }
    }
    /**
     * Drop a waiter whose caller gave up. Still queued: remove it, the active
     * count is untouched. Already granted and merely cooling down: the slot is
     * his, so pass it on exactly as release() would.
     */
    cancel(waiter) {
        if (waiter.granted) {
            if (waiter.timer)
                clearTimeout(waiter.timer);
            waiter.timer = null;
            log.debug(`${waiter.label} left during the cooldown, passing its slot on`);
            waiter.resolve("abandoned");
            this.release();
            return;
        }
        const index = this.waiters.indexOf(waiter);
        if (index >= 0)
            this.waiters.splice(index, 1);
        waiter.detach();
        log.debug(`dropped queued ${waiter.label} (caller gone)`);
        waiter.resolve("abandoned");
    }
}
