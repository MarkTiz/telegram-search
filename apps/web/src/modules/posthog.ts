/**
 * PostHog telemetry — disabled in this fork.
 *
 * Upstream initializes posthog-js here (us.i.posthog.com). Keep the named
 * export so main.ts and future upstream merges stay clean; do not re-enable
 * without an explicit local opt-in.
 */
export function initPosthog() {
  // intentionally no-op
}
