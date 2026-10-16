/**
 * OpenTelemetry log export — removed in this fork.
 * Kept as a named no-op so server bootstrap / upstream merges stay clean.
 */
export function emitOtelLog(
  _level: string,
  _context: string,
  _message: string,
  _attributes?: Record<string, string | number | boolean>,
): void {
  // intentionally no-op — no OTLP export
}
