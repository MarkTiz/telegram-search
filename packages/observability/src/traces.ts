/**
 * OpenTelemetry spans — removed in this fork.
 * withSpan still runs the work, but never creates or exports spans.
 */
export async function withSpan<T>(
  _spanName: string,
  fn: () => Promise<T> | T,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return await fn()
}
