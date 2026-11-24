export interface UsageWindow {
    name: string;
    /** Percentage used, 0-100. */
    used: number;
    display: string;
    /** Credits consumed. */
    amount: number;
    /** Credits still available. */
    remaining: number;
    display_remaining: string;
    limit: number;
    unit: "credits";
}
export interface UsageReport {
    plan?: string;
    windows: UsageWindow[];
    error?: string;
}
/** Compact credit counts for the display string (12345 → "1.2万"). */
export declare function formatCredit(value: number): string;
/** Build the usage report from the statistics payload. */
export declare function usageFromStatistics(raw: unknown): UsageReport;
