# S9 Observability — Metrics, Tracing & Alerting Hooks

**Sprint:** 9 (T3) · **Status:** Implemented (backend) · **Scope:** Prometheus-compatible metrics + correlation tracing (existing) + documented alert rules. No Grafana/Alertmanager deployment (KISS, ADR-008).

---

## 1. What exists

| Component | Endpoint/Mechanism | Notes |
|---|---|---|
| Metrics endpoint | `GET /metrics` (version-neutral, outside `/api/v1`) | Prometheus text format; `@Public` (Q6) — restrict to infra network at deploy |
| HTTP metrics | Global `HttpMetricsInterceptor` | `http_request_duration_seconds` + `http_requests_total` {method, route, status} |
| Worker metrics | `QueueEventsListener` (BullMQ QueueEvents) | `worker_jobs_total` {queue, status:completed\|failed}. **Zero S8 worker diff** (AD-3) |
| Outbox gauge | `InfraGauges` (30s interval) | `outbox_unpublished_events` (count of unpublished domain_events) |
| Default metrics | prom-client `collectDefaultMetrics` | process CPU/memory/event-loop |
| Tracing | existing correlation middleware | `x-correlation-id` spans request → service → worker → log |
| Logging | nestjs-pino (existing) | `/metrics` + `/health` excluded from autolog |

## 2. Cardinality discipline (HARD RULE)

Labels are **constant, low-cardinality sets only**: method, route-pattern, status, queue, state.
**Never** org/branch/patient/staff/doctor IDs, UUIDs, or query strings in labels.
Enforced by test (`s9-observability.spec.ts` cardinality assertions).

## 3. Alerting hooks (documented rules — wire into your alert stack in S10)

| # | Rule (PromQL-ish) | Severity | Meaning |
|---|---|---|---|
| A1 | `outbox_unpublished_events > 100` for 10m | HIGH | Outbox dispatcher down or DB write pressure |
| A2 | `rate(worker_jobs_total{status="failed"}[5m]) > 0.2/s` | HIGH | Worker failure storm (WA transport/Bukku) |
| A3 | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` | MEDIUM | API p95 latency degradation |
| A4 | `rate(http_requests_total{status=~"5.."}[5m]) > 0.1/s` | HIGH | Server error rate |
| A5 | `up{job="medini-backend"} == 0` | CRITICAL | Process down (scrape target) |
| A6 | `/health/ready` returns `not_ready` | CRITICAL | Dependency (PG) unreachable |

Operator distinction guide: A5/A6 = application/DB failure; A2 = worker/integration failure; A1 = queue durability risk; A3/A4 = performance/auth boundary pressure.

## 4. Scraping

```yaml
# prometheus.yml (deploy-time; not in repo runtime)
scrape_configs:
  - job_name: medini-backend
    metrics_path: /metrics
    static_configs:
      - targets: ['backend:3000']
```

## 5. Deliberately deferred (S10)

- Grafana dashboards / Alertmanager deployment
- OpenTelemetry distributed tracing (correlation-ID logging is v1)
- PagerDuty/on-call integration
- Per-branch/per-org metric breakdowns (cardinality rule)
