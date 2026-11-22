export type AcquireOutcome = "admitted" | "abandoned" | "queue-full";
export declare class ConcurrencyGate {
    private readonly limit;
    private readonly cooldownMs;
    private readonly maxQueue;
    private active;
    private readonly waiters;
    constructor(limit: number, cooldownMs?: number, maxQueue?: number);
    /**
     * Take a slot or wait for one. `admitted` means the caller owes exactly one
     * `release()`; `abandoned` means the signal aborted while queued (no slot was
     * taken, nothing is owed); `queue-full` means the request was refused.
     */
    acquire(label: string, signal?: AbortSignal): Promise<AcquireOutcome>;
    release(): void;
    /**
     * Drop a waiter whose caller gave up. Still queued: remove it, the active
     * count is untouched. Already granted and merely cooling down: the slot is
     * his, so pass it on exactly as release() would.
     */
    private cancel;
}
