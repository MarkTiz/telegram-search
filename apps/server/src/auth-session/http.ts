import type { Config } from '@tg-search/common'
import type { H3 } from 'h3'

import { assertBodySize, defineEventHandler, HTTPError, readBody } from 'h3'
import { array, maxLength, minLength, object, parse, pipe, regex, string } from 'valibot'

import { importAuthSessions, isAuthSessionStoreEnabled, listPublicAuthSessions } from './service'

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

const sessionImportSchema = object({
  sessions: pipe(
    array(object({
      id: pipe(string(), regex(/^[\w-]{1,128}$/)),
      session: pipe(string(), minLength(1), maxLength(8192)),
    })),
    maxLength(20),
  ),
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export function registerAuthSessionRoutes(app: H3, config: Config): void {
  app.get('/auth/sessions', defineEventHandler(async () => {
    if (!isAuthSessionStoreEnabled())
      return json({ authority: 'client', sessions: [] })

    return json({
      authority: 'server',
      sessions: await listPublicAuthSessions(),
    })
  }))

  app.post('/auth/sessions', defineEventHandler(async (event) => {
    if (!isAuthSessionStoreEnabled())
      return json({ authority: 'client', sessions: [] }, 409)

    try {
      assertBodySize(event, 64 * 1024)
      const body = parse(sessionImportSchema, await readBody(event))
      const sessions = await importAuthSessions(config, body.sessions)
      return json({ authority: 'server', sessions })
    }
    catch (error) {
      if (error instanceof HTTPError)
        throw error
      return json({ error: 'Invalid auth session import' }, 400)
    }
  }))
}
