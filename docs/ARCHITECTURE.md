# Архитектурная схема

Схема отражает текущий дизайн из [DESIGN.md](./DESIGN.md): одна NestJS-служба отдаёт API и собранный frontend, PostgreSQL хранит состояние ленты, сторонний Image Search API вызывается только из фоновой загрузки после `POST /api/searches`.

## Runtime view

```mermaid
flowchart LR
  user["Пользователь<br/>браузер"] -->|GET /, static assets| app
  user -->|POST /api/searches<br/>GET /api/feed?query=...| app

  subgraph container["Docker Compose / VPS"]
    app["app container<br/>NestJS + static frontend"]
    pg["postgres container<br/>PostgreSQL 17<br/>volume: pgdata"]
  end

  app -->|Prisma<br/>read/write SearchResult| pg
  app -.->|background fetch only<br/>GET /search?q=...<br/>X-API-Token| upstream["Image Search API<br/>service.test.elvetech.io"]

  app -->|GET /health| health["healthcheck"]
  pg -->|pg_isready| pghealth["postgres healthcheck"]
```

## Backend layers

```mermaid
flowchart TB
  http["HTTP layer<br/>FeedController<br/>DTO + status codes"] --> service["FeedService<br/>business rules"]
  service --> repo["SearchResultRepository<br/>Prisma persistence"]
  service --> provider["ImageProviderService<br/>upstream HTTP client"]

  repo --> db[("PostgreSQL<br/>search_results")]
  provider --> upstream["Image Search API"]

  common["Common infrastructure<br/>ValidationPipe<br/>ResponseEnvelopeInterceptor<br/>GlobalExceptionFilter<br/>pino logs"] -.-> http
  common -.-> service
```

## Submit/poll flow

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant Backend as NestJS API
  participant DB as PostgreSQL
  participant Upstream as Image Search API

  Browser->>Backend: POST /api/searches { query }
  Backend->>DB: upsert/mark PENDING for query and query graffiti
  Backend-->>Browser: 202 { left, right statuses }

  par Background left side
    Backend->>Upstream: GET /search?q=query
    Upstream-->>Backend: items or error
    Backend->>DB: mark READY/FAILED
  and Background right side
    Backend->>Upstream: GET /search?q=query graffiti
    Upstream-->>Backend: items or error
    Backend->>DB: mark READY/FAILED
  end

  loop while any side is PENDING
    Browser->>Backend: GET /api/feed?query=...
    Backend->>DB: read both SearchResult rows
    Backend-->>Browser: 200 { statuses, zipped items }
  end
```

## Ключевые ограничения

- `GET /api/feed` read-only: он никогда не вызывает сторонний сервис.
- Долгий upstream-запрос не держит HTTP-соединение браузера: загрузка идёт в фоне.
- Источник истины для статусов `PENDING` / `READY` / `FAILED` — PostgreSQL.
- Кэширование применяется отдельно к каждому upstream-запросу: `<query>` и `<query> graffiti`.
