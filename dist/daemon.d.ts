/** The bits of a child process the supervisor needs (injectable for tests). */
export interface SupervisedChild {
    onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
    kill: (signal?: NodeJS.Signals) => void;
}
export interface SupervisorOptions {
    /** Start (or restart) the proxy. */
    launch: () => SupervisedChild;
    /** Set by the signal handlers; the loop exits once the child is gone. */
    shouldStop?: () => boolean;
    /** Injected in tests to keep the loop synchronous. */
    delay?: (ms: number) => Promise<void>;
    now?: () => number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    /** A run that lasted at least this long counts as healthy and resets the backoff. */
    healthyAfterMs?: number;
    onRestart?: (info: {
        attempt: number;
        code: number | null;
        signal: NodeJS.Signals | null;
        uptimeMs: number;
        nextDelayMs: number;
    }) => void;
}
/**
 * Run `launch()` forever, back off between restarts, and return once the child
 * has exited and `shouldStop()` says the shutdown was intentional.
 */
export declare function supervise(opts: SupervisorOptions): Promise<void>;
/** Where the supervisor records its pid (package root, not the caller's cwd). */
export declare function daemonPidFilePath(): string;
