import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { SpanEventRecord, SpanRecord, TraceDetail, TraceSummary } from '@/types/trace';

const MAX_JSON_PREVIEW = 2000;

function formatTimestamp(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDuration(startedAt: number, endedAt: number | null) {
  if (!endedAt || endedAt < startedAt) return '--';
  const durationMs = endedAt - startedAt;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

function formatJsonPreview(value: unknown) {
  if (value == null) return '—';
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= MAX_JSON_PREVIEW) return serialized;
    return `${serialized.slice(0, MAX_JSON_PREVIEW)}...`;
  } catch {
    return String(value);
  }
}

function getSpanLabel(span: SpanRecord) {
  return span.name || span.id;
}

export function LLMTracingPage() {
  const { t } = useLocale();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTraces = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await databaseService.getTraces();
      setTraces(list);
      if (list.length > 0) {
        setSelectedTraceId((current) => current ?? list[0]?.id ?? null);
      } else {
        setSelectedTraceId(null);
        setDetail(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Tracing.loadError;
      setError(message);
      logger.error('Failed to load traces', err);
    } finally {
      setLoadingList(false);
    }
  }, [t.Tracing.loadError]);

  const loadTraceDetail = useCallback(
    async (traceId: string) => {
      setLoadingDetail(true);
      setError(null);
      try {
        const result = await databaseService.getTraceDetails(traceId);
        setDetail(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : t.Tracing.loadError;
        setError(message);
        logger.error('Failed to load trace detail', err);
      } finally {
        setLoadingDetail(false);
      }
    },
    [t.Tracing.loadError]
  );

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    if (selectedTraceId) {
      loadTraceDetail(selectedTraceId);
    }
  }, [selectedTraceId, loadTraceDetail]);

  const selectedTrace = detail?.trace ?? null;
  const spanEventsMap = detail?.eventsBySpanId ?? {};

  const traceListContent = useMemo(() => {
    if (loadingList) {
      return (
        <div className="space-y-2 p-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      );
    }

    if (error) {
      return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
    }

    if (traces.length === 0) {
      return <div className="p-4 text-sm text-muted-foreground">{t.Tracing.emptyDescription}</div>;
    }

    return (
      <div className="space-y-2 p-3">
        {traces.map((trace) => {
          const isSelected = trace.id === selectedTraceId;
          return (
            <button
              key={trace.id}
              type="button"
              className={`w-full rounded border px-3 py-2 text-left transition ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200'
                  : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-800 dark:hover:bg-gray-900'
              }`}
              onClick={() => setSelectedTraceId(trace.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{trace.id}</span>
                <Badge variant="secondary">{trace.spanCount}</Badge>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatTimestamp(trace.startedAt)}</span>
                <span>{formatDuration(trace.startedAt, trace.endedAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [error, loadingList, selectedTraceId, t.Tracing.emptyDescription, traces]);

  const detailContent = useMemo(() => {
    if (loadingDetail) {
      return (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    if (!selectedTrace) {
      return <div className="p-6 text-sm text-muted-foreground">{t.Tracing.selectTrace}</div>;
    }

    return (
      <div className="space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold">{t.Tracing.detailTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{selectedTrace.id}</p>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">{t.Tracing.startedAtLabel}:</span>{' '}
              {formatTimestamp(selectedTrace.startedAt)}
            </div>
            <div>
              <span className="font-medium text-foreground">{t.Tracing.durationLabel}:</span>{' '}
              {formatDuration(selectedTrace.startedAt, selectedTrace.endedAt)}
            </div>
            <div>
              <span className="font-medium text-foreground">{t.Tracing.spanCountLabel}:</span>{' '}
              {selectedTrace.spanCount}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-base font-semibold">{t.Tracing.spansTitle}</h3>
          {detail?.spans.length ? (
            <div className="mt-3 space-y-4">
              {detail.spans.map((span) => (
                <Card key={span.id}>
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">{getSpanLabel(span)}</CardTitle>
                      <Badge variant="outline">
                        {formatDuration(span.startedAt, span.endedAt)}
                      </Badge>
                    </div>
                    <CardDescription className="font-mono text-xs">{span.id}</CardDescription>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(span.startedAt)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground">
                        {t.Tracing.attributesLabel}
                      </div>
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
                        {formatJsonPreview(span.attributes)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground">
                        {t.Tracing.eventsTitle}
                      </div>
                      {(() => {
                        const events = spanEventsMap[span.id] ?? [];
                        if (events.length === 0) {
                          return (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {t.Tracing.noEvents}
                            </div>
                          );
                        }

                        return (
                          <div className="mt-2 space-y-2">
                            {events.map((event) => (
                              <TraceEventRow key={event.id} event={event} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">{t.Tracing.noSpans}</div>
          )}
        </div>
      </div>
    );
  }, [detail, loadingDetail, selectedTrace, spanEventsMap, t.Tracing]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{t.Tracing.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.Tracing.description}</p>
        </div>
        <Button onClick={loadTraces} disabled={loadingList}>
          {t.Common.refresh}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-full max-w-sm border-r">
          <Card className="h-full rounded-none border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.Tracing.listTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-180px)]">{traceListContent}</ScrollArea>
            </CardContent>
          </Card>
        </div>
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[calc(100vh-140px)]">{detailContent}</ScrollArea>
        </div>
      </div>
    </div>
  );
}

function TraceEventRow({ event }: { event: SpanEventRecord }) {
  const payloadPreview = formatJsonPreview(event.payload);

  return (
    <details className="rounded border px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{event.eventType}</Badge>
          <span className="text-muted-foreground">{formatTimestamp(event.timestamp)}</span>
        </div>
        <span className="text-muted-foreground">{event.id}</span>
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs dark:bg-gray-900">
        {payloadPreview}
      </pre>
    </details>
  );
}
