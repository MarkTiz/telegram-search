/**
 * OpenTelemetry Node SDK registration — removed in this fork.
 * Kept so `import { registerOtel } from '@tg-search/observability/node'` still resolves.
 */
export function registerOtel(_options?: { debug?: boolean | number, version?: string }) {
  // intentionally no-op — no SDK, no exporters, no instrumentations
}
