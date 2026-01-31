import type { SpanEventRecord, SpanRecord, TraceDetail, TraceSummary } from '@/types/trace';
import type { TursoClient } from './turso-client';

const DEFAULT_TRACE_LIMIT = 50;

function safeJsonParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toTraceSummary(row: {
  id: string;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
  span_count?: number | null;
}): TraceSummary {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    metadata: safeJsonParse(row.metadata),
    spanCount: row.span_count ?? 0,
  };
}

function toSpanRecord(row: {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  started_at: number;
  ended_at: number | null;
  attributes: string | null;
}): SpanRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id ?? null,
    name: row.name,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    attributes: safeJsonParse(row.attributes),
  };
}

function toSpanEventRecord(row: {
  id: string;
  span_id: string;
  timestamp: number;
  event_type: string;
  payload: string | null;
}): SpanEventRecord {
  let payload: unknown = null;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = row.payload;
    }
  }

  return {
    id: row.id,
    spanId: row.span_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    payload,
  };
}

export class TraceService {
  constructor(private db: TursoClient) {}

  async getTraces(limit = DEFAULT_TRACE_LIMIT, offset = 0): Promise<TraceSummary[]> {
    const rows = await this.db.select<
      Array<{
        id: string;
        started_at: number;
        ended_at: number | null;
        metadata: string | null;
        span_count: number | null;
      }>
    >(
      `SELECT
        t.id,
        t.started_at,
        t.ended_at,
        t.metadata,
        (SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.id) AS span_count
      FROM traces t
      ORDER BY t.started_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return rows.map(toTraceSummary);
  }

  async getTraceDetails(traceId: string): Promise<TraceDetail | null> {
    const traceRows = await this.db.select<
      Array<{
        id: string;
        started_at: number;
        ended_at: number | null;
        metadata: string | null;
        span_count: number | null;
      }>
    >(
      `SELECT
        t.id,
        t.started_at,
        t.ended_at,
        t.metadata,
        (SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.id) AS span_count
      FROM traces t
      WHERE t.id = $1`,
      [traceId]
    );

    const traceRow = traceRows[0];
    if (!traceRow) {
      return null;
    }

    const spanRows = await this.db.select<
      Array<{
        id: string;
        trace_id: string;
        parent_span_id: string | null;
        name: string;
        started_at: number;
        ended_at: number | null;
        attributes: string | null;
      }>
    >(
      `SELECT
        id,
        trace_id,
        parent_span_id,
        name,
        started_at,
        ended_at,
        attributes
      FROM spans
      WHERE trace_id = $1
      ORDER BY started_at ASC`,
      [traceId]
    );

    const spans = spanRows.map(toSpanRecord);
    if (spans.length === 0) {
      return {
        trace: toTraceSummary(traceRow),
        spans,
        eventsBySpanId: {},
      };
    }

    const spanIds = spans.map((span) => span.id);
    const placeholders = spanIds.map((_, idx) => `$${idx + 1}`).join(',');
    const eventRows = await this.db.select<
      Array<{
        id: string;
        span_id: string;
        timestamp: number;
        event_type: string;
        payload: string | null;
      }>
    >(
      `SELECT
        id,
        span_id,
        timestamp,
        event_type,
        payload
      FROM span_events
      WHERE span_id IN (${placeholders})
      ORDER BY timestamp ASC`,
      spanIds
    );

    const eventsBySpanId: Record<string, SpanEventRecord[]> = {};
    for (const row of eventRows) {
      const event = toSpanEventRecord(row);
      const bucket = eventsBySpanId[event.spanId] ?? [];
      if (!eventsBySpanId[event.spanId]) {
        eventsBySpanId[event.spanId] = bucket;
      }
      bucket.push(event);
    }

    return {
      trace: toTraceSummary(traceRow),
      spans,
      eventsBySpanId,
    };
  }
}
