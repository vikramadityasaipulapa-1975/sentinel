import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { RequestHandler } from "express";

export interface RequestTrace {
  span: Span;
  tracer: Tracer;
}
export function traceHeaders(span?: Span): Record<string, string> {
  if (!span) return {};
  const value = span.spanContext();
  return { traceparent: `00-${value.traceId}-${value.spanId}-01` };
}
export function tracing() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!endpoint)
    return { middleware: ((_q, _s, next) => next()) as RequestHandler };
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "4418" ||
    url.pathname !== "/v1/traces" ||
    url.search ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      "Tracing endpoint must be the fixed local OTLP HTTP receiver",
    );
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": "checkout-service" }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: endpoint, timeoutMillis: 1000 }),
        {
          maxQueueSize: 256,
          maxExportBatchSize: 64,
          scheduledDelayMillis: 500,
          exportTimeoutMillis: 1500,
        },
      ),
    ],
  });
  const tracer = provider.getTracer("sentinel-demo");
  const middleware: RequestHandler = (request, response, next) => {
    if (request.path !== "/checkout") {
      next();
      return;
    }
    // Checkout is the untrusted ingress boundary: create a fresh root, ignore incoming baggage/context.
    const span = tracer.startSpan(
      "POST /checkout",
      { kind: SpanKind.SERVER },
      ROOT_CONTEXT,
    );
    response.locals.trace = { span, tracer } satisfies RequestTrace;
    response.set("x-trace-id", span.spanContext().traceId);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      span.setAttribute("http.response.status_code", response.statusCode);
      if (response.statusCode >= 500 || !response.writableFinished)
        span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    };
    response.once("finish", end);
    response.once("close", end);
    next();
  };
  return { middleware, provider };
}
export function clientSpan(value?: RequestTrace) {
  return value?.tracer.startSpan(
    "POST payment",
    { kind: SpanKind.CLIENT },
    trace.setSpan(ROOT_CONTEXT, value.span),
  );
}
