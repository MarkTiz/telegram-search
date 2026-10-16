export function redactEventData<T>(data: T): T {
  if (!data || typeof data !== 'object' || !('session' in data))
    return data

  const session = (data as { session?: unknown }).session
  return {
    ...data,
    session: typeof session === 'string' && session.length > 0 ? '[present]' : session,
  }
}
