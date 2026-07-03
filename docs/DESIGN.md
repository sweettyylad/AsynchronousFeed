# Проектирование

Требования — [REQUIREMENTS.md](./REQUIREMENTS.md) (Rn/In), допущения — [ASSUMPTIONS.md](./ASSUMPTIONS.md) (An).

---

## 1. Общая модель работы

Ключевое ограничение — R7: запрос к стороннему сервису может длиться дольше таймаута фронтенд→бэкенд. Поэтому модель **submit → poll**:

```
Пользователь                Backend                          Image Search API
    │  POST /api/searches      │                                    │
    │  {query:"cat"} ─────────►│ upsert 2 записи SearchResult       │
    │                          │ (cat / cat graffiti), для          │
    │                          │ несвежих — status=PENDING          │
    │◄──── 202 {left,right} ───│ и фоновый fetch (без await) ──────►│  GET /search?q=cat
    │                          │                        ───────────►│  GET /search?q=cat+graffiti
    │  GET /api/feed?query=cat │                                    │
    │ ────────────────────────►│ читает обе записи из БД,           │
    │◄─── 200 {items, statuses}│ зипует пары. НИКОГДА не ходит ─X──►│
    │  (poll каждые ~2s,       │ в сторонний сервис (A3)            │
    │   пока есть PENDING)     │                                    │
```

- POST отвечает мгновенно (202), фоновая загрузка живёт в процессе, её результат фиксируется в БД → R7.
- GET отдаёт частичное состояние: одна сторона READY, вторая PENDING → R8.
- Перезагрузка страницы: фронтенд читает `?q=` из URL и делает только GET → R6 (A2, A3).
- Правило 1 часа применяется в POST: свежая (`fetchedAt` < 1ч) сторона не перезапрашивается → R9 (A4).

## 2. Архитектура NestJS

### Модули и слои

```
src/
├── main.ts                     # bootstrap: pipes, filters, shutdown hooks
├── app.module.ts
├── config/                     # ConfigModule: загрузка + zod-валидация env
│   ├── config.module.ts
│   └── config.schema.ts        # zod-схема env (fail fast при старте, I5)
├── common/                     # сквозные вещи, без бизнес-логики
│   ├── exceptions/             # AppException и наследники
│   ├── filters/                # GlobalExceptionFilter → единый формат ошибок
│   └── interceptors/           # ResponseEnvelopeInterceptor, логирование запросов
├── prisma/
│   ├── prisma.module.ts        # @Global
│   └── prisma.service.ts       # connect/disconnect (graceful shutdown, I7)
├── image-provider/             # клиент стороннего сервиса
│   ├── image-provider.module.ts
│   ├── image-provider.service.ts   # GET /search, таймаут, ретраи 429/5xx (A6)
│   └── image-provider.schemas.ts   # zod-схема ответа upstream (I4)
├── feed/                       # основной домен
│   ├── feed.module.ts
│   ├── feed.controller.ts      # POST /api/searches, GET /api/feed
│   ├── feed.service.ts         # оркестрация: кэш-решение, запуск fetch, зип пар
│   ├── search-result.repository.ts  # весь доступ к Prisma в домене
│   ├── query.util.ts           # нормализация query (A5)
│   └── dto/                    # DTO запросов/ответов (class-validator)
└── health/
    └── health.controller.ts    # GET /health (I8)
```

**Границы ответственности:**

| Слой | Отвечает за | Не знает про |
|---|---|---|
| Controller | HTTP: DTO, коды ответов | Prisma, upstream |
| `FeedService` | Бизнес-правила: нормализация, правило 1ч, дедупликация PENDING, запуск фоновой загрузки, спаривание постов | HTTP, SQL |
| `SearchResultRepository` | Персистентность `SearchResult` (upsert, findByQueries, условные переходы статусов) | HTTP, upstream, бизнес-правила |
| `ImageProviderService` | HTTP к стороннему API: токен, таймаут, ретраи, валидация ответа | БД, лента |

### Guards / Interceptors / Pipes / Filters

- **Pipes:** глобальный `ValidationPipe` (`whitelist: true`, `transform: true`) — все DTO через class-validator (I1).
- **Filters:** глобальный `GlobalExceptionFilter` — любое исключение → единый формат ошибки (§5), незнакомые ошибки → 500 без утечки внутренностей, с логированием stack.
- **Interceptors:** `ResponseEnvelopeInterceptor` — оборачивает успешные ответы в envelope (§4); HTTP-логирование через `nestjs-pino` (I6).
- **Guards:** не используются — аутентификации нет (см. REQUIREMENTS § Вне скоупа). Фиксируем это осознанно.

### Фоновая загрузка (без очереди)

`FeedService.triggerFetch(query)`:
1. Repository: атомарный переход в `PENDING` (upsert; для существующей записи — только если она устарела: `fetchedAt` старше 1ч / `FAILED` / «зависший» `PENDING` старше `PENDING_STALE_SECONDS`, A7). Условный `updateMany` возвращает count=0, если другой запрос уже перевёл в PENDING → дедупликация конкурентных сабмитов (I11).
2. Если переход случился — `void this.fetchAndStore(query)` (промис не await-ится; ошибки ловятся внутри, `catch` пишет `FAILED` — ничего не всплывает unhandled).
3. `fetchAndStore`: `ImageProviderService.search(query)` → `READY` + items + `fetchedAt=now()` либо `FAILED` + error.

Устойчивость без очереди: источник истины — статус в БД; упавший процесс оставляет `PENDING`, который протухает и перезапускается следующим POST (A7). Обоснование отказа от очереди — § Trade-offs T2.

## 3. Модель данных (Prisma)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SearchStatus {
  PENDING
  READY
  FAILED
}

model SearchResult {
  id        String       @id @default(uuid())
  /// Нормализованный текст upstream-запроса ("cat" или "cat graffiti").
  /// Единица кэширования (ASSUMPTIONS A4).
  query     String       @unique
  status    SearchStatus
  /// Массив постов [{url, width, height, tags[]}] как JSONB.
  /// Обоснование JSON vs отдельная таблица — DESIGN § Trade-offs T3.
  items     Json         @default("[]")
  /// Сообщение об ошибке при status=FAILED.
  error     String?
  /// Момент успешного ответа upstream; NULL пока не было ни одного успеха.
  /// База для правила "не старше 1 часа" (R9).
  fetchedAt DateTime?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@map("search_results")
}
```

**Индексы (каждый обоснован):**

| Индекс | Зачем |
|---|---|
| `@unique(query)` | Единственный путь доступа: и POST (upsert по ключу кэша), и GET (чтение двух строк по query) ищут по этому полю. Уникальность одновременно гарантирует «одна запись на upstream-запрос» — на этом держится дедупликация. |
| Других индексов нет | Осознанно (YAGNI): нет запросов по `status`/`fetchedAt` без `query` (проверка свежести идёт по уже найденной строке); PK по `id` — служебный. Лишние индексы = лишние записи на каждый upsert. |

Одна таблица на всё приложение — да, и это нормально: домен — кэш результатов поиска. Отношений нет, потому что «пара L/R» — производная (зип двух списков во время чтения), а не хранимая сущность.

## 4. Контракты API

Все ответы — в едином envelope:

```jsonc
// успех
{ "success": true,  "data": { ... }, "error": null }
// ошибка
{ "success": false, "data": null,   "error": { "code": "STRING_CODE", "message": "human readable" } }
```

### POST `/api/searches` — сабмит поискового запроса

Запрос (`SubmitSearchDto`, class-validator):

```jsonc
{ "query": "cat" }   // string, после trim непустая, max 100 символов (A5)
```

Ответ **202 Accepted** (`SearchAcceptedDto`) — состояние сторон на момент сабмита:

```jsonc
{
  "success": true,
  "data": {
    "query": "cat",                    // нормализованный
    "left":  { "query": "cat",          "status": "READY"   },  // из кэша, свежий
    "right": { "query": "cat graffiti", "status": "PENDING" }   // запущена фоновая загрузка
  },
  "error": null
}
```

Ошибки: `400 VALIDATION_ERROR` (пустой/длинный query).

Семантика: идемпотентен по нормализованному query; свежие стороны (<1ч) не трогает (R9), несвежие переводит в PENDING и запускает загрузку. Наружу к upstream в рамках самого HTTP-запроса не ходит никогда — только запускает фон (R7).

### GET `/api/feed?query=cat` — чтение ленты

Read-only, к стороннему сервису не обращается никогда (R6, A3).

Ответ **200 OK** (`FeedDto`):

```jsonc
{
  "success": true,
  "data": {
    "query": "cat",
    "left":  { "query": "cat",          "status": "READY",   "fetchedAt": "2026-07-03T10:00:00Z", "error": null },
    "right": { "query": "cat graffiti", "status": "PENDING", "fetchedAt": null,                    "error": null },
    "items": [                                   // зип по max-длине (A1); формируется на бэкенде (R5)
      { "left": { "url": "https://...", "width": 1200, "height": 800, "tags": ["cat","cute"] },
        "right": null },                          // правая сторона ещё не готова (R8)
      { "left": { ... }, "right": null }
    ]
  },
  "error": null
}
```

Ошибки: `400 VALIDATION_ERROR` (нет/пустой `query`), `404 FEED_NOT_FOUND` (по этому query ещё не было сабмита — фронтенд в этом случае сам делает POST).

Polling-контракт для фронтенда: повторять GET каждые ~2s, пока `left.status` или `right.status` == `PENDING`.

### GET `/health`

**200** `{ "success": true, "data": { "status": "ok" }, "error": null }` — процесс жив + ping БД. Используется healthcheck-ом compose (I8).

### Сводка кодов

| Код | Когда |
|---|---|
| 200 | GET успешен |
| 202 | POST принят (фоновая загрузка запущена или всё из кэша) |
| 400 | Невалидный вход (`VALIDATION_ERROR`) |
| 404 | Лента по query не существует (`FEED_NOT_FOUND`) |
| 500 | Необработанная ошибка (`INTERNAL_ERROR`), детали только в логах |

Ошибки стороннего сервиса **не** транслируются в HTTP-коды нашего API: они фиксируются как `status: "FAILED"` + `error` соответствующей стороны в теле 200/202 (I3). Клиенту всегда есть что показать.

## 5. Обработка ошибок

Иерархия (в `common/exceptions/`):

```
AppException (abstract: code, httpStatus, message)
├── ValidationException          → 400 VALIDATION_ERROR   (также маппинг ошибок ValidationPipe)
├── FeedNotFoundException        → 404 FEED_NOT_FOUND
└── UpstreamException            → не покидает FeedService: становится FAILED-статусом стороны
    ├── UpstreamTimeoutException      ("сервис не ответил за N секунд")
    ├── UpstreamRateLimitException    ("превышен лимит запросов, попробуйте позже")
    └── UpstreamBadResponseException  (не-2xx после ретраев / невалидная схема ответа)
```

`GlobalExceptionFilter`: `AppException` → его код/статус; `HttpException` NestJS → маппинг в envelope; всё прочее → 500 `INTERNAL_ERROR`, полный stack в лог, наружу только generic-сообщение (I2). Пользовательские сообщения — человекочитаемые; технические детали (`статус upstream, тело ответа`) — только в логах (I6).

## 6. Конфигурация

Загрузка через `@nestjs/config`, валидация zod-схемой при старте — невалидный конфиг роняет процесс до бинда порта (I5).

| Переменная | Обязательная | Дефолт | Описание |
|---|---|---|---|
| `NODE_ENV` | нет | `production` | режим |
| `PORT` | нет | `3000` | порт HTTP |
| `DATABASE_URL` | **да** | — | PostgreSQL DSN |
| `IMAGE_API_BASE_URL` | нет | `https://service.test.elvetech.io` | база стороннего API |
| `IMAGE_API_TOKEN` | **да** | — | `X-API-Token` (A9) |
| `CACHE_TTL_SECONDS` | нет | `3600` | «не старше 1 часа» (R9) |
| `UPSTREAM_TIMEOUT_MS` | нет | `60000` | таймаут одного запроса к upstream |
| `UPSTREAM_RETRY_ATTEMPTS` | нет | `3` | попыток на 429/5xx (A6) |
| `PENDING_STALE_SECONDS` | нет | `120` | когда «зависший» PENDING можно перезапустить (A7) |
| `LOG_LEVEL` | нет | `info` | уровень pino |

## 7. Frontend (минимальный, A8)

`frontend/` — Vite + TypeScript strict, без фреймворка. Одна страница:

- input + submit → `POST /api/searches`, затем `history.pushState('?q=...')` и polling `GET /api/feed`.
- При загрузке страницы: если в URL есть `?q=` → сразу `GET /api/feed` (реализация R6); на `404 FEED_NOT_FOUND` — автоматический POST.
- Рендер: вертикальный список item-ов, в item две колонки (img + теги); для `PENDING`-стороны — skeleton/spinner, для `FAILED` — сообщение об ошибке (R8, I3).
- Сборка в статику, отдаётся NestJS через `@nestjs/serve-static` (multi-stage Docker build).

## 8. Инфраструктура

- **docker-compose:** сервисы `app` (multi-stage: build frontend → build backend → runtime, non-root user) и `postgres` (`postgres:17-alpine`, volume, healthcheck `pg_isready`). `app` стартует после healthy postgres; entrypoint: `prisma migrate deploy && node dist/main.js` (R12).
- **Graceful shutdown:** `app.enableShutdownHooks()`; PrismaService отключается в `onModuleDestroy` (I7).
- **Логи:** `nestjs-pino`, JSON в stdout (docker-friendly), request-id (I6).

## 9. Trade-offs (ключевые решения)

### T1. Кэш в PostgreSQL, без Redis

- **Альтернатива:** Redis с TTL как классический кэш.
- **Выбор:** одна PostgreSQL; «свежесть» — сравнение `fetchedAt` с `now() - CACHE_TTL`.
- **Почему:** персистентность нужна в любом случае (R6 — состояние переживает перезагрузку и рестарт), значит БД обязательна. Дублировать те же данные в Redis — второй store, второй контейнер, инвалидация двух копий — без выигрыша: нагрузка тестового сервиса на чтение ничтожна, JSONB-строка по unique-индексу читается за миллисекунды. Redis станет оправдан при горизонтальном масштабировании (распределённые локи) — отражено в README «что улучшил бы».

### T2. Фоновая загрузка in-process, без очереди (BullMQ и т.п.)

- **Альтернатива:** BullMQ + Redis: надёжные ретраи, переживание рестартов, воркеры.
- **Выбор:** `void promise` внутри процесса + статусы в БД; условный update как лок; протухание PENDING (A7) как самовосстановление.
- **Почему:** нагрузка — 2 upstream-запроса на сабмит; единственный риск (процесс умер во время загрузки) закрыт протуханием PENDING. Очередь добавила бы Redis, воркер, сериализацию задач — заметная доля сложности всего проекта ради сценария, который и так обработан. Классический YAGNI для тестового задания.

### T3. Посты как JSONB-колонка, а не таблица `posts`

- **Альтернатива:** нормализованная `Post(id, searchResultId, url, width, height, tags[], position)`.
- **Выбор:** `items Json` внутри `SearchResult`.
- **Почему:** посты читаются и пишутся только целым списком в составе результата запроса; ни одного сценария адресации отдельного поста, фильтрации или join нет (API отдаёт зип двух целых списков). Реляционная таблица дала бы транзакционную вставку N строк, индекс по FK и сортировку по position — плата без запросов, которые бы её окупили. Валидацию структуры даёт zod на границе с upstream (I4).

### T4. Polling, а не SSE/WebSocket

- **Альтернатива:** SSE-стрим статусов (изящнее для R8).
- **Выбор:** фронтенд опрашивает GET `/api/feed` каждые ~2s до готовности обеих сторон.
- **Почему:** R7 требует лишь не держать долгих HTTP-запросов; интервал в 2s даёт время реакции намного меньше времени загрузки upstream. SSE добавляет управление соединениями, reconnect-логику и усложняет прокси/деплой. Для двух статусов на страницу — не окупается.

## 10. План тестирования (сводно; детали в [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md))

- **Unit (Jest):** нормализация query; правило свежести 1ч (границы: 59м59с / ровно 1ч / 1ч + 1с); зип пар при равных/разных длинах/пустых списках (A1); логика ретраев и backoff провайдера (мок HTTP через `undici MockAgent`, фейковые таймеры); переходы статусов.
- **Integration (Testcontainers PostgreSQL + мок upstream):** полный цикл POST→фон→GET; частичная готовность (R8); повторный POST в пределах часа не ходит в upstream (R9); протухший кэш перезапрашивается; конкурентные POST — один поход в upstream (I11); 429→ретрай→успех; окончательный сбой→FAILED в API; 404 по неизвестному query; валидация 400.
- **Не покрываем e2e с реальным сторонним сервисом** — недетерминирован, rate limits; финальная ручная проверка по чек-листу перед сдачей.
