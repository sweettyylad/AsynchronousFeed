# Анализ требований

Источник требований — [Task.md](../Task.md) (тестовое задание на позицию NodeJS Developer).
Второй фактический источник — OpenAPI-спецификация стороннего сервиса
(`https://service.test.elvetech.io/openapi.json`, раздел Task.md «Third-party Service»).

---

## 1. Явные требования (из Task.md)

### Функциональные

- [x] **R1. Frontend + Backend.**
  Цитата: *«You need to develop the frontend and backend of a web application. The main focus should be on the backend part»* (Task Overview).
  Интерпретация: делаем оба слоя, но фронтенд — минимально достаточный (форма запроса + отрисовка ленты + индикация загрузки). Все усилия по качеству — в бэкенд.

- [x] **R2. Лента изображений по текстовому запросу.**
  Цитата: *«The application allows users to see a feed of images based on the user's text query. A third-party service is used as the data source»* (App Functionality).
  Интерпретация: пользователь вводит текст → получает ленту. Источник данных — только сторонний Image Search API.

- [x] **R3. Структура ленты: пары постов.**
  Цитата: *«The feed consists of several items, one below another. Each item in the feed consists of 2 posts, one on the left, one on the right. Each post represents an image and a list of tags retrieved for that image»* (App Functionality).
  Интерпретация: item = пара {left, right}; пост = картинка + теги (поля `url`, `tags` из ответа стороннего сервиса; `width`/`height` тоже сохраняем — пригодятся для верстки).

- [x] **R4. Два запроса к стороннему сервису: `<query>` и `<query> graffiti`.**
  Цитата: *«This action triggers 2 requests from the backend to the third-party service. One request is the entered text, the second is the entered text plus the word "graffiti"»* (App Functionality).
  Интерпретация: левая колонка — результаты по `<query>`, правая — по `<query> graffiti`. Спаривание позиционное: L1↔R1, L2↔R2, … (пример в Task.md).

- [x] **R5. Лента формируется на бэкенде.**
  Цитаты: *«The data received from the third-party service should be transformed into the feed on the backend side»* (App Functionality) и *«The feed structure must be formed on the backend side»* (Important Things).
  Интерпретация: API бэкенда отдаёт уже спаренный массив `items: [{left, right}]`. Фронтенд ничего не «зипует».

- [x] **R6. Состояние ленты переживает перезагрузку страницы без похода в сторонний сервис.**
  Цитата: *«After the query, the user must be able to reload the page and — without sending a request to the third-party service — get the current state of the requested feed from the backend»* (App Functionality).
  Интерпретация: результаты запросов персистятся на бэкенде (PostgreSQL); отдельный read-only эндпоинт чтения ленты никогда не ходит в сторонний сервис. Какой запрос «текущий» — хранит фронтенд (query в URL), см. [ASSUMPTIONS.md](./ASSUMPTIONS.md) A2.

- [x] **R7. Запрос к стороннему сервису может длиться дольше таймаута фронтенд→бэкенд.**
  Цитата: *«the request from the backend to the third-party service may take longer than the timeout of the request from the frontend to the backend»* (Important Things).
  Интерпретация: нельзя держать HTTP-запрос фронтенда открытым до ответа стороннего сервиса. Асинхронная модель: POST запускает фоновую загрузку и сразу отвечает; фронтенд опрашивает состояние (polling GET).

- [x] **R8. Частичные результаты.**
  Цитата: *«If one of the feed requests has already returned a result, but the other has not — you need to show the posts from the request that responded, while showing the user that the second request has not finished yet»* (Important Things).
  Интерпретация: статус хранится и отдаётся отдельно для каждой стороны (left/right); лента отдаётся с готовой стороной и `null` вместо ещё не загруженной, UI показывает индикатор загрузки второй стороны.

- [x] **R9. Кэширование на бэкенде, TTL 1 час.**
  Цитата: *«if we have loaded posts for a query no older than 1 hour, return them without making a request to the third-party service»* (Important Things).
  Интерпретация: ключ кэша — нормализованный текст запроса к стороннему сервису (для каждой из двух сторон отдельно); при повторном сабмите свежие (<1ч) результаты не перезапрашиваются.

- [x] **R10. Учёт rate limits стороннего сервиса.**
  Цитата: *«The service has rate limits»* (Third-party Service). OpenAPI: ответ `429 Rate limit exceeded`.
  Интерпретация: обработка 429 (ретраи с экспоненциальным backoff), кэш и дедупликация одновременных одинаковых запросов как основные механизмы снижения нагрузки.

### Технические / деливери

- [x] **R11. NodeJS / TypeScript.**
  Цитата: *«The task should be done using NodeJS / TypeScript. The rest of the stack is your choice»* (Tech Requirements).
  Интерпретация: стек выбран: NestJS, TS strict, PostgreSQL + Prisma. Обоснование выбора — [DESIGN.md](./DESIGN.md) § Trade-offs.

- [x] **R12. Docker Compose со всеми зависимостями.**
  Цитата: *«The application with all its dependencies must be wrapped in Docker Compose»* (Task Overview).
  Интерпретация: `docker compose up` поднимает приложение + PostgreSQL, миграции применяются автоматически.

- [x] **R13. Приложение доступно по ссылке.**
  Цитаты: *«The web application must be accessible via a link»* (Task Overview), *«A link to the web application»* (Deliverables).
  Интерпретация: нужен деплой на публичный хост (VPS / Fly.io / Railway и т.п.). Отдельный финальный шаг плана.

- [x] **R14. GitHub-репозиторий с исходниками.**
  Цитата: *«A github repository with source code (public or shared by request)»* (Deliverables).

- [x] **R15. Готовность обосновать выбор библиотек.**
  Цитата: *«You can use any open-source frameworks or libraries but be prepared to reason your choices»* (Tech Requirements).
  Интерпретация: обоснования фиксируем письменно — [DESIGN.md](./DESIGN.md) § Trade-offs и README.

---

## 2. Неявные требования (production-quality по умолчанию)

Явных формулировок в Task.md нет; ожидаются от «real startup work: … ship something we can try» (Context).

- [x] **I1. Валидация входных данных**: query — непустая строка, ограничение длины; невалидный вход → 400 с понятным сообщением.
- [x] **I2. Единый формат ошибок API** и корректные HTTP-коды (400 / 404 / 500 / 502).
- [x] **I3. Обработка сбоев стороннего сервиса**: таймаут, 429, 5xx, невалидное тело ответа → статус `FAILED` стороны ленты с сообщением пользователю, а не «зависший» спиннер и не 500 на весь запрос.
- [x] **I4. Валидация ответа стороннего сервиса** (схема через zod): не доверяем внешним данным.
- [x] **I5. Валидация конфигурации при старте**: отсутствие `IMAGE_API_TOKEN` / `DATABASE_URL` → быстрый fail с внятной ошибкой.
- [x] **I6. Логирование**: структурные логи (pino), запросы к стороннему сервису и их исходы логируются.
- [x] **I7. Graceful shutdown**: обработка SIGTERM/SIGINT, закрытие HTTP-сервера и соединений с БД (важно под Docker).
- [x] **I8. Health-check эндпоинт** (`GET /health`) + healthcheck в docker-compose.
- [x] **I9. Тесты**: unit (Jest) + integration (Testcontainers + мок стороннего API). Цель покрытия — 80%+ бизнес-логики.
- [x] **I10. README**: запуск одной командой, описание API, допущения.
- [x] **I11. Дедупликация конкурентных запросов**: два одновременных сабмита одного query не порождают двойных походов в сторонний сервис.
- [x] **I12. Секреты не в коде**: токен только через переменные окружения; `.env` в `.gitignore`, есть `.env.example`.

---

## 3. Вне скоупа

Осознанно НЕ делаем (в Task.md не требуется; для тестового — оверинжиниринг):

| Что | Почему нет |
|---|---|
| Аутентификация / пользователи / сессии | В Task.md нет понятия пользователя как сущности; «current state» привязан к запросу, не к пользователю (см. ASSUMPTIONS A2) |
| Очередь задач (BullMQ / RabbitMQ) | Фоновая загрузка — 2 запроса на сабмит; in-process достаточно, устойчивость обеспечивает статус в БД (DESIGN § Trade-offs T2) |
| Redis | Кэш живёт в PostgreSQL (TTL-проверка по `fetchedAt`); второй store не даёт выгоды на одном инстансе (DESIGN § Trade-offs T1) |
| WebSocket / SSE | Polling проще и полностью закрывает R7/R8; real-time не требуется |
| Пагинация ленты / бесконечный скролл | Сторонний сервис отдаёт фиксированный список; в Task.md пагинации нет |
| Горизонтальное масштабирование, метрики, трейсинг | Не требуется заданием; упомянуто в README «что бы я улучшил» |
| Продвинутый UI (роутинг, стейт-менеджер, дизайн-система) | «Main focus should be on the backend part» |
| Rate limiting собственного API | Полезно, но не требуется; отмечено как улучшение |

---

## 4. Критерии оценки (что ревьюер проверит в первую очередь)

Приоритет по формулировкам Task.md («Important Things to Consider» — фактически чек-лист проверяющего):

1. **`docker compose up` → работает по ссылке** — первое, что попробуют (R12, R13). Если не поднялось — остальное не посмотрят.
2. **Асинхронность (R7)** — самый дискриминирующий пункт: держит ли бэкенд соединение открытым, или есть честная модель «submit → poll». Проверят медленным ответом стороннего сервиса.
3. **Частичные результаты (R8)** — одна сторона готова, вторая крутится; UI это показывает.
4. **Кэш 1 час (R9)** — повторный сабмит того же query не ходит в сторонний сервис (проверяемо по логам/latency).
5. **Перезагрузка страницы (R6)** — F5 после запроса восстанавливает ленту без похода в сторонний сервис.
6. **Формирование ленты на бэкенде (R5)** — смотрят ответ API: там уже пары.
7. **Обработка 429 и ошибок стороннего сервиса (R10, I3)** — сервис тестовый, наверняка специально отдаёт 429/медленные ответы.
8. **Качество кода и тестов** — структура, типизация strict, тесты, README, обоснование выбора стека (R15).
