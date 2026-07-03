# Image Feed — VoicePop Test Task

Веб-приложение: пользователь вводит текстовый запрос и получает ленту пар изображений — слева результаты по запросу `<query>`, справа по `<query> graffiti`. Данные берутся из стороннего Image Search API, лента формируется на бэкенде, результаты кэшируются на 1 час и переживают перезагрузку страницы.

> **Статус:** локальная реализация готова к финальной проверке и деплою. Публичная ссылка добавляется отдельным шагом деплоя из [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Стек

NestJS 11 · TypeScript (strict) · PostgreSQL 17 + Prisma · Vite (frontend, vanilla TS) · Jest + Testcontainers · Docker Compose

## Требования к окружению

- Docker + Docker Compose (для запуска приложения)
- Node.js ≥ 22 и npm (только для локальной разработки и тестов)
- API-токен стороннего сервиса (`X-API-Token`)

## Запуск

```bash
cp .env.example .env    # заполнить IMAGE_API_TOKEN
docker compose up --build
```

Приложение: http://localhost:3000 (миграции применяются автоматически при старте).

## Тесты

```bash
npm install
npm test              # unit
npm run test:int      # integration + e2e (Testcontainers — нужен запущенный Docker)
npm run test:cov      # покрытие
```

## Структура проекта

```
docs/               # проектная документация (см. ниже)
prisma/             # Prisma-схема и миграции
src/
  config/           # загрузка и zod-валидация env
  common/           # exceptions / filters / interceptors (единый формат ошибок)
  prisma/           # PrismaService (подключение, graceful shutdown)
  image-provider/   # клиент стороннего Image Search API (таймауты, ретраи 429/5xx)
  feed/             # домен: controller / service / repository, DTO, зип пар
  health/           # GET /health
test/               # integration- и e2e-тесты (Testcontainers)
frontend/           # Vite + TS: одна страница с polling
```

## Документация

| Документ | Содержание |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Чек-листы явных и неявных требований, скоуп, критерии оценки |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Все неоднозначности задания и принятые решения |
| [docs/DESIGN.md](docs/DESIGN.md) | Архитектура, схема данных, контракты API, обработка ошибок, trade-offs |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Mermaid-схемы runtime/deploy view, backend layers и submit/poll flow |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Пошаговый план с критериями готовности и планом тестирования |

## API (сводка)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/searches` | Сабмит запроса: применяет кэш-правило (1 час), запускает фоновую загрузку несвежих сторон, отвечает 202 сразу |
| GET | `/api/feed?query=…` | Чтение состояния ленты (пары постов + статус каждой стороны). Read-only, к стороннему сервису не обращается |
| GET | `/health` | Health-check |

Полные контракты — [docs/DESIGN.md § 4](docs/DESIGN.md).

## Assumptions & Trade-offs (выжимка)

- **Submit → poll.** Запрос к стороннему сервису может длиться дольше таймаута фронтенда, поэтому POST отвечает мгновенно (202), загрузка идёт в фоне, фронтенд опрашивает GET каждые ~2 секунды. Polling вместо SSE/WebSocket — осознанно: проще, полностью закрывает требование.
- **Кэш в PostgreSQL, без Redis.** Персистентность нужна в любом случае (лента переживает перезагрузку), правило «не старше 1 часа» — сравнение `fetchedAt`. Второй store не даёт выгоды на одном инстансе.
- **Без очереди задач.** Фоновая загрузка in-process; источник истины — статус в БД; «зависшие» PENDING протухают и перезапускаются следующим сабмитом. BullMQ для двух запросов на сабмит — оверинжиниринг.
- **Кэш-ключ — каждый upstream-запрос отдельно** (`cat` и `cat graffiti` независимо), нормализованный (trim/lowercase/схлопывание пробелов) — максимум переиспользования.
- **«Текущий» запрос живёт в URL** (`?q=cat`), не в серверной сессии: в задании нет пользователей/авторизации. После F5 фронтенд делает только GET — сторонний сервис не вызывается, даже если кэш протух (правило 1 часа применяется только при явном сабмите).
- **Пары при разной длине списков** — зип по длинной стороне, недостающая сторона `null` (не прячем реально полученные посты).
- **Ошибки upstream не валят запрос**: сторона получает статус `FAILED` с сообщением, вторая сторона показывается. 429 — до 3 ретраев с экспоненциальным backoff и уважением `Retry-After`.

Полные обоснования: [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md), [docs/DESIGN.md § 9](docs/DESIGN.md).

## Что бы я улучшил при большем времени

- SSE вместо polling — мгновенное появление готовой стороны без опроса.
- Rate limiting и защита собственного API (throttler, request size limits).
- Redis + распределённые локи — при горизонтальном масштабировании (сейчас дедупликация корректна в рамках одного инстанса на уровне БД).
- Retry-политика с circuit breaker для стороннего сервиса.
- CI (GitHub Actions): lint + tests + build на каждый PR.
- Метрики (Prometheus) и трейсинг запросов к upstream.
- Прелоад/плейсхолдеры изображений по `width`/`height`, виртуализация длинной ленты.
