# План реализации

Порядок: каркас → слои снизу вверх (repository → service → controller) → интеграционные тесты → фронтенд → инфраструктура → деплой.
Каждый шаг маленький, самодостаточный, с явным критерием готовности (DoD).

**Контекст для исполнителя любого шага:** [DESIGN.md](./DESIGN.md) — обязательно; [ASSUMPTIONS.md](./ASSUMPTIONS.md) — при работе с бизнес-правилами; Task.md не обязателен (требования уже разложены в [REQUIREMENTS.md](./REQUIREMENTS.md)).

Подход — TDD, где тестируемая логика уже отделена от IO: сначала тест (RED), затем реализация (GREEN), рефакторинг.

---

## Этап A. Каркас

### Шаг 1. Инициализация проекта
- **Файлы:** уже созданы на этапе документации: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`, `.env.example`, `.gitignore`. Выполнить `npm install`, зафиксировать `package-lock.json`.
- **Контекст:** README § структура.
- **DoD:** `npm install` без ошибок; `npx tsc --noEmit` проходит на пустом src.

### Шаг 2. Prisma: схема и миграция
- **Файлы:** `prisma/schema.prisma`, `prisma.config.ts`, миграция `prisma/migrations/*_init/`.
- **Контекст:** DESIGN §3 (схема целиком, включая комментарии-обоснования). Сверить синтаксис генератора с документацией Prisma 7 (`prisma-client` provider, `prisma.config.ts`).
- **DoD:** `npx prisma migrate dev` на локальном Postgres (docker) создаёт таблицу `search_results`; `npx prisma generate` порождает типизированный клиент; `tsc` проходит.

### Шаг 3. Конфигурация с валидацией
- **Файлы:** `src/config/config.schema.ts`, `src/config/config.module.ts` + unit-тест схемы.
- **Контекст:** DESIGN §6 (таблица переменных).
- **DoD:** unit-тесты: валидный env парсится с дефолтами; отсутствие `IMAGE_API_TOKEN` или `DATABASE_URL` → ошибка с именем переменной.

### Шаг 4. Скелет приложения NestJS
- **Файлы:** `src/main.ts`, `src/app.module.ts`, `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`, `src/health/health.controller.ts`, `src/common/interceptors/response-envelope.interceptor.ts`, `src/common/filters/global-exception.filter.ts`, `src/common/exceptions/*` (иерархия из DESIGN §5).
- **Контекст:** DESIGN §2 (bootstrap: ValidationPipe, filter, interceptor, shutdown hooks), §4 (envelope), §5.
- **DoD:** `npm run start:dev` поднимается; `GET /health` → `{"success":true,"data":{"status":"ok"},...}`; несуществующий путь → envelope-ошибка 404; SIGTERM завершает процесс чисто.

## Этап B. Слои снизу вверх

### Шаг 5. Утилита нормализации query (TDD)
- **Файлы:** `src/feed/query.util.ts`, `src/feed/query.util.spec.ts`.
- **Контекст:** ASSUMPTIONS A5.
- **DoD:** тесты: trim, схлопывание пробелов, lowercase, пустая строка → ошибка, 100+ символов → ошибка; построение правого запроса `<q> graffiti`.

### Шаг 6. ImageProviderService (TDD)
- **Файлы:** `src/image-provider/image-provider.module.ts`, `image-provider.service.ts`, `image-provider.schemas.ts`, `image-provider.service.spec.ts`.
- **Контекст:** DESIGN §2 (границы слоя), ASSUMPTIONS A6; OpenAPI upstream: `GET /search?q=`, заголовок `X-API-Token`, ответ `{items:[{url,width,height,tags}]}`, ошибки 400/401/429/502.
- **Тесты (undici `MockAgent` + fake timers):** успех → распарсенные items; невалидное тело → `UpstreamBadResponseException`; 429 → ретрай с backoff → успех; 429 с `Retry-After` — уважается; исчерпание попыток → `UpstreamRateLimitException`; таймаут → `UpstreamTimeoutException`; 5xx → ретрай.
- **DoD:** все тесты зелёные; в сервисе нет упоминаний Prisma/ленты.

### Шаг 7. SearchResultRepository (TDD, integration)
- **Файлы:** `src/feed/search-result.repository.ts`, `test/search-result.repository.int-spec.ts` (Testcontainers PostgreSQL).
- **Контекст:** DESIGN §2 (переход в PENDING как условный атомарный update — это фундамент дедупликации I11), §3, ASSUMPTIONS A7.
- **Тесты:** upsert новой записи в PENDING; `tryMarkPending` возвращает false для свежей READY (<1ч) и для недавнего PENDING; true — для протухших READY/FAILED/зависшего PENDING; конкурентные `tryMarkPending` (Promise.all) — ровно один true; `markReady`/`markFailed`; `findByQueries` возвращает пары.
- **DoD:** интеграционные тесты зелёные локально (`npm run test:int`).

### Шаг 8. FeedService (TDD, unit с моками repo/provider)
- **Файлы:** `src/feed/feed.service.ts`, `src/feed/feed.service.spec.ts`.
- **Контекст:** DESIGN §1 (модель submit→poll), §2 (фоновая загрузка без await, ошибки не всплывают), ASSUMPTIONS A1, A4, A7.
- **Тесты:** submit запускает fetch только для несвежих сторон; fetch-ошибка → `markFailed`, промис не reject-ится; зип пар — равные/разные длины/пустые (A1); `getFeed` для неизвестного query → `FeedNotFoundException`; `getFeed` не вызывает provider ни при каких статусах (R6/A3 — прямой тест).
- **DoD:** unit-тесты зелёные; покрытие service+util ≥ 80%.

### Шаг 9. FeedController + DTO
- **Файлы:** `src/feed/feed.controller.ts`, `src/feed/dto/*.ts`, `src/feed/feed.module.ts`, подключение в `app.module.ts`.
- **Контекст:** DESIGN §4 (контракты дословно — формы DTO, коды 202/400/404).
- **DoD:** e2e-тест (supertest, замоканный service): POST валидный → 202 в envelope; POST пустой query → 400 `VALIDATION_ERROR`; GET без query → 400; GET неизвестный → 404 `FEED_NOT_FOUND`.

## Этап C. Интеграционные тесты полного цикла

### Шаг 10. E2E-сценарии (Testcontainers + мок upstream)
- **Файлы:** `test/feed.e2e-spec.ts`, `test/helpers/*` (запуск приложения на контейнерном Postgres, upstream через undici MockAgent).
- **Контекст:** DESIGN §10, REQUIREMENTS §4 (список — фактически сценарии ревьюера).
- **Сценарии (обязательные edge cases):**
  1. POST → обе стороны PENDING → GET показывает пустую ленту со статусами → после завершения фона GET отдаёт пары (R5, R7).
  2. Одна сторона быстрая, вторая медленная → GET между ними: items с `right: null`, `right.status=PENDING` (R8).
  3. Повторный POST того же query в пределах часа → к upstream ноль новых запросов (R9); проверка через счётчик мока.
  4. `fetchedAt` старше часа (подменить в БД) → POST перезапрашивает.
  5. Параллельные POST одного query → ровно 2 запроса к upstream, не 4 (I11).
  6. Upstream отдаёт 429 дважды, потом 200 → сторона READY (R10).
  7. Upstream падает окончательно → сторона FAILED с сообщением; второй POST перезапускает (A7).
  8. Разные длины списков L/R → зип по max с null (A1).
- **DoD:** `npm run test:int` зелёный; суммарное покрытие ≥ 80%.

## Этап D. Frontend

### Шаг 11. Страница ленты
- **Файлы:** `frontend/` (Vite + TS: `index.html`, `src/main.ts`, `src/api.ts`, `src/render.ts`, стили).
- **Контекст:** DESIGN §7, §4 (polling-контракт), ASSUMPTIONS A2, A8.
- **DoD:** ручной сценарий против запущенного бэкенда: сабмит → скелетоны → лента пар; F5 восстанавливает ленту из URL без POST (виден только GET в network); сторона FAILED показывает ошибку.

## Этап E. Инфраструктура и сдача

### Шаг 12. Docker
- **Файлы:** `Dockerfile` (multi-stage: frontend build → backend build → runtime non-root), правка `docker-compose.yml` при необходимости, `.dockerignore`.
- **Контекст:** DESIGN §8, README § запуск.
- **DoD:** на чистой машине `docker compose up --build` с одним заполненным `.env` → приложение на `http://localhost:3000`, миграции применились, healthcheck зелёный, `docker compose down && up` сохраняет данные (volume).

### Шаг 13. Финальная вычитка и ручной чек-лист
- **Контекст:** REQUIREMENTS §4 (пройти все 8 пунктов руками), README.
- **DoD:** все чекбоксы REQUIREMENTS §1–2 проставлены; lint/tests/build зелёные; в коде нет console.log, секретов, TODO.

### Шаг 14. Деплой
- **Файлы:** при необходимости конфиг платформы (fly.toml / caddy).
- **Контекст:** ASSUMPTIONS A10.
- **DoD:** публичная ссылка открывается, полный пользовательский сценарий проходит; ссылка добавлена в README.

---

## Сводный план тестирования

| Уровень | Инструмент | Что покрывает |
|---|---|---|
| Unit | Jest (+ undici MockAgent, fake timers) | query.util; правило 1ч (границы 59:59 / 1:00:00 / 1:00:01); зип пар (равные, разные, пустые); ретраи/backoff/Retry-After; FeedService-оркестрация с моками |
| Integration | Jest + Testcontainers (PostgreSQL) | repository: атомарность tryMarkPending, конкурентность |
| E2E (API) | Jest + Testcontainers + supertest + мок upstream | 8 сценариев шага 10 — прямое отражение критериев ревьюера |
| Ручное | браузер | фронтенд-сценарии (шаг 11), продовый чек-лист (шаг 13) |

**Обязательные edge cases (сквозной список):** пустой/пробельный query; query = 100 и 101 символ; upstream вернул пустой `items`; разные длины L/R; ровно 1 час с момента `fetchedAt`; конкурентные сабмиты; 429 с `Retry-After` и без; таймаут upstream; рестарт приложения при PENDING (протухание, A7); F5 при протухшем кэше (лента отдаётся, upstream не вызывается — A3).
