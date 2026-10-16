import type { CoreCounter, CoreHistogram, CoreMetrics } from '@tg-search/common'

/**
 * In-process metric stubs. OpenTelemetry exporters/readers were removed so
 * nothing is sent to an OTLP endpoint even if OTEL_* env vars are set.
 */

type LabelAttrs = Record<string, string>

function noopAddable() {
  return {
    add(_value?: number, _attributes?: LabelAttrs) {},
  }
}

function noopHistogram() {
  return {
    record(_value?: number, _attributes?: LabelAttrs) {},
  }
}

function noopCoreCounter(): CoreCounter {
  return {
    inc(_labels?: Record<string, string>, _value?: number) {},
  }
}

function noopCoreHistogram(): CoreHistogram {
  return {
    observe(_labels: Record<string, string>, _value: number) {},
  }
}

export const wsSendFailTotal = noopAddable()
export const wsConnectionsActive = noopAddable()
export const coreEventsInTotal = noopAddable()
export const coreMessagesProcessedTotal = noopAddable()
export const coreMessageBatchesProcessedTotal = noopAddable()
export const coreMessageBatchDurationMs = noopHistogram()
export const coreResolverDurationMs = noopHistogram()
export const coreTakeoutDownloadedTotal = noopAddable()
export const coreTakeoutPageFetchTotal = noopAddable()
export const coreTakeoutPageFetchDurationMs = noopHistogram()
export const coreTakeoutSessionInitTotal = noopAddable()
export const coreTakeoutChatDurationMs = noopHistogram()
export const coreTakeoutRunTotal = noopAddable()
export const coreResolverOutcomeTotal = noopAddable()
export const coreResolverSkippedTotal = noopAddable()
export const coreEmbeddingApiCallTotal = noopAddable()
export const coreEmbeddingTokensTotal = noopAddable()
export const coreMediaDownloadTotal = noopAddable()
export const coreVisionApiCallTotal = noopAddable()
export const coreEntityResolveTotal = noopAddable()
export const coreTakeoutPageMessages = noopHistogram()

export const coreMetrics: CoreMetrics = {
  messagesProcessed: noopCoreCounter(),
  messageBatchDuration: noopCoreHistogram(),
  resolverDuration: noopCoreHistogram(),
  takeoutDownloadTotal: noopCoreCounter(),
  takeoutPageFetchTotal: noopCoreCounter(),
  takeoutPageFetchDurationMs: noopCoreHistogram(),
  takeoutSessionInitTotal: noopCoreCounter(),
  takeoutChatDurationMs: noopCoreHistogram(),
  takeoutRunTotal: noopCoreCounter(),
  resolverOutcome: noopCoreCounter(),
  resolverSkipped: noopCoreCounter(),
  embeddingApiCall: noopCoreCounter(),
  embeddingTokens: noopCoreCounter(),
  mediaDownload: noopCoreCounter(),
  visionApiCall: noopCoreCounter(),
  entityResolve: noopCoreCounter(),
  takeoutPageMessages: noopCoreHistogram(),
}
