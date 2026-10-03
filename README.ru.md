<div align="center">

# 🎼 Divaldi

**ИИ‑движок расчёта коммерческих предложений для обработки металла**

*Загрузи чертёж. Получи расчитанное коммерческое предложение.*

[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Angular](https://img.shields.io/badge/frontend-Angular%2021-DD0031?logo=angular&logoColor=white)](https://angular.dev)
[![Python](https://img.shields.io/badge/python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![PostgreSQL](https://img.shields.io/badge/db-PostgreSQL%2018-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![RabbitMQ](https://img.shields.io/badge/broker-RabbitMQ%204-FF6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com)
[![Redis](https://img.shields.io/badge/cache-Redis%208-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Garage](https://img.shields.io/badge/storage-Garage-EEEEEE?logo=rust&logoColor=black)](https://garagehq.deuxfleurs.fr)
[![TaskIQ](https://img.shields.io/badge/queue-TaskIQ-FFD34E?logoColor=black)](https://taskiq-python.github.io)

[🇬🇧 English](README.md) · [🇷🇺 Русский](README.ru.md)

</div>

---

## 🎯 Что такое Divaldi?

Divaldi — внутреннее веб‑приложение для **ООО НПО «Энергон»**, предприятия по
обработке металла. Оно превращает **чертежи** заказчика в **рассчитанное коммерческое
предложение** (КП) в формате Excel — полностью автоматически.

Инженер загружает чертёж в PDF/DXF, добавляет краткое описание и общается с ИИ‑технологом,
который читает чертёж, определяет материал, извлекает геометрию, задаёт уточняющие
вопросы, если данных не хватает, и в итоге формирует расчитанный `.xlsx` по реальным
производственным нормам цеха.

```
   📐 Чертёж (PDF / DXF / PNG / JPEG)
              │
              ▼
   ┌──────────────────────────┐
   │  Задачи предобработки     │  PDF → PNG 150 DPI · DXF → отчёт с измерениями
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │   ИИ-модель GigaChat      │  читает изображения, текст DXF и сообщение
   │   структурированный JSON  │  материал · площадь · гибы · сварка · часы
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │  processing.calculator   │  заполняет res/calc.xlsx по нормам
   └──────────────────────────┘
              │
              ▼
        📊 kp.xlsx  (КП)
```

---

## ✨ Возможности

### 👷 Для инженеров

| | Возможность | Подробности |
|---|---|---|
| 💬 | **Чат с ИИ-технологом** | Асинхронная генерация, индикатор статуса, Markdown с подсветкой кода |
| 📎 | **Загрузка чертежей** | Drag‑and‑drop, PDF · DXF · PNG · JPEG, до **30 МБ**, не более 3 параллельных загрузок |
| 🔍 | **Автоматический разбор файлов** | Страницы PDF растрируются в 150 DPI; сущности DXF разбираются в отчёт с измерениями |
| ❓ | **Уточняющий диалог** | Если не хватает размеров или материала, агент задаёт точные вопросы и пересчитывает |
| 📊 | **Коммерческое предложение** | Расчитанный `.xlsx` по производственным нормам (лазер / сварка / гибка / покраска) |
| 📄 | **Просмотр файлов** | Предпросмотр PDF, изображений, `.docx` и `.xlsx` (с вычислением формул) |
| 🕘 | **История заявок** | Сортируемая, по дате активности, со скелетонами и пустыми состояниями |
| 🔁 | **Повтор генерации** | Один клик после ошибки |
| 🌗 | **Светлая / тёмная тема** | Сохраняется в `localStorage` |
| 👤 | **Профиль и аватар** | PNG/JPEG/WebP, приводится к WebP |

### 🛡️ Для администраторов

| | Возможность | Подробности |
|---|---|---|
| 👥 | **Управление пользователями** | Поиск, создание, редактирование, удаление |
| 📅 | **Срок действия аккаунта** | `expires_at` со статусами «активен» / «истекает» / «истёк» |
| 🔑 | **Смена пароля** | Только суперпользователем; полностью отключено при `TEST_INSTANCE_MODE` |
| 🚦 | **Режим тестового стенда** | `TEST_INSTANCE_MODE=true` блокирует разрушающие операции кодом HTTP `450` |

### ⚙️ Для эксплуатации

| | Возможность | Подробности |
|---|---|---|
| 📈 | **Панель TaskIQ** | История задач, результаты, ошибки |
| 🐇 | **Управление RabbitMQ** | Длина очередей и состояние воркеров |
| 🗄️ | **Admin API Garage** | Статус кластера, раскладка, ключи |
| ♻️ | **Автоочистка хранилища** | Правила ILM удаляют необработанные аватары (1 д), вложения (7 д), артефакты (1 д) |
| 🧹 | **Плановые очистки** | Ежечасные задачи удаляют устаревшие результаты, «сиротские» вложения и истёкшие сессии |

---

## 🏗️ Архитектура

```
divaldi/
├── backend/          FastAPI + SQLAlchemy 2.0 (async) + Alembic + TaskIQ
│   ├── app/
│   │   ├── routes/       HTTP-слой — по одному APIRouter на домен
│   │   ├── schemas/      Модели запросов/ответов Pydantic v2
│   │   ├── models/       ORM-модели SQLAlchemy
│   │   ├── tasks/        Фоновые задачи TaskIQ (очереди default и network)
│   │   ├── providers/    ИИ-клиент GigaChat (Sber)
│   │   ├── cache.py      Клиент Redis + все билдеры ключей кэша
│   │   ├── storage.py    Объектное хранилище S3 (Garage)
│   │   ├── deps.py       Алиасы зависимостей на базе Annotated
│   │   └── harness.py    Системный промпт + схема структурированного вывода
│   ├── alembic/          Миграции (пока одна — initial)
│   ├── res/              Шаблон calc.xlsx, сертификат GigaChat
│   └── tests/            pytest + testcontainers
├── processing/        Общая библиотека: растеризация PDF, парсер DXF, калькулятор Excel
├── frontend/          Angular 21 standalone + signals + SCSS
├── conf/              Конфигурация инфраструктуры: redis.conf, garage.toml, garage-init.sh, правила жизненного цикла, инициализация БД
├── scripts/           Обёртки pre-commit для инструментов Poetry
└── docker-compose.yaml
```

### 🔁 Жизненный цикл запроса

1. `POST /api/v1/chats` создаёт сессию и возвращает `202`.
2. Сообщение попадает в очередь **`network`** (`generate_chat_message`).
3. Воркер загружает вложения в GigaChat и запрашивает структурированный JSON‑ответ.
4. Если агент вернул позиции → заполняется `res/calc.xlsx` → `kp.xlsx` попадает в Garage.
5. Если список `positions` пуст — агент задал уточняющие вопросы.
6. Фронтенд опрашивает `GET /chats/{id}/result` каждые 2 с (таймаут 5 мин) — WebSocket'ов нет.

### 🧾 Две очереди задач

| Очередь | Назначение | Задачи |
|---|---|---|
| `default` | Локальные / CPU‑задачи | Разбор DXF, растеризация PDF, нормализация аватаров, обработка результатов, очистки |
| `network` | Обращения к GigaChat | `generate_chat_message`, `upload_pdf_image` |

Разделение гарантирует, что медленный внешний API не блокирует локальный конвейер.

---

## 🧰 Технологии

**Backend** — Python 3.14 · FastAPI · SQLAlchemy 2.0 (async) · asyncpg · Alembic · Pydantic v2 · TaskIQ · structlog · argon2‑cffi · aioboto3 · Pillow · uvicorn

**Processing** — PyMuPDF · Pillow · openpyxl (DXF парсится чистым Python, без `ezdxf`)

**Frontend** — Angular 21 (standalone, signals) · TypeScript 5.9 · SCSS (BEM + CSS-переменные) · RxJS · Vitest · ESLint · Prettier

**Инфраструктура** — Docker Compose · PostgreSQL 18 · Redis 8 · RabbitMQ 4 · Garage

---

## 🚀 Быстрый старт

### 📋 Требования

- 🐳 **Docker** с **Docker Compose v2**
- 📝 Файл `.env` с секретами, отмеченными обязательными в [таблице ниже](#-переменные-окружения)

> ⚠️ **Весь проект запускается только через Docker Compose.** Бэкенд ожидает
> имена сервисов (`db`, `redis`, `rabbitmq`, `garage`) и два пути, разрешаемые
> относительно рабочей директории `backend/`. Локального запуска приложения не
> существует. Отдельные сервисы можно запускать локально для редактирования, но
> *запуск* — это Compose.

### 1️⃣ Клонировать

```bash
git clone https://github.com/yel-gar/divaldi.git
cd divaldi
```

### 2️⃣ Настроить

```bash
# Linux / macOS
cp .env{.example,}
```

```powershell
# Windows PowerShell
PS> Copy-Item .env.example .env
```

Заполните обязательные значения — как минимум `POSTGRES_PASSWORD`, `RABBITMQ_PASS`,
`TASKIQ_API_TOKEN`, `S3_SECRET_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`,
`SBER_API_KEY`, `SBER_API_SCOPE`.

Генерация секретов:

```bash
openssl rand -hex 48
```

### 3️⃣ Запустить

```bash
docker compose up -d --build
docker compose logs -f
```

### 4️⃣ Создать администратора

Регистрации **нет** — первый аккаунт создаётся интерактивно:

```bash
# Linux / macOS
chmod +x createsuperuser.sh
./createsuperuser.sh
```

```powershell
# Windows PowerShell
PS> .\createsuperuser.ps1
```

### 5️⃣ Войти

Откройте **http://localhost:8080** и войдите под созданным аккаунтом. 🎉

---

## 🔌 Сервисы и порты

| Сервис | URL | Примечание |
|---|---|---|
| 🌐 **Фронтенд** | http://localhost:8080 | nginx, проксирует `/api` на бэкенд |
| ⚡ **Backend API** | http://localhost:3000 | документация `/api/v1/docs` — **только при включённом `DEBUG`** |
| 📈 **Панель TaskIQ** | http://localhost:8000 | нужен `TASKIQ_API_TOKEN` |
| 🐇 **RabbitMQ** | http://localhost:15672 | пользователь `RABBITMQ_USER` / `RABBITMQ_PASS` |
| 🗄️ **Admin API Garage** | http://localhost:3903 | нужен `GARAGE_ADMIN_TOKEN` |
| 🗃️ **Garage S3 API** | http://localhost:3900 | сюда указывают presigned-ссылки на загрузку и скачивание |
| 🐘 **PostgreSQL** | `localhost:5432` | `5431` в dev-оверрайде |

### Сервисы Compose

| Сервис | Роль |
|---|---|
| `frontend` | Сборка Angular, раздаётся nginx |
| `backend` | FastAPI + uvicorn |
| `migrate` | одноразовый `alembic upgrade head`, остальные ждут его |
| `scheduler` | Планировщик TaskIQ (периодические задачи) |
| `worker_default` | ×2 реплики на очереди `default` |
| `worker_network` | ×2 реплики на очереди `network` |
| `taskiq_dashboard` | наблюдаемость задач |
| `db` | PostgreSQL 18 (`shm_size: 512mb`) |
| `redis` | кэш, блокировки, лимиты запросов |
| `rabbitmq` | брокер задач, vhost `taskiq` |
| `garage` | S3-совместимое хранилище объектов (`--single-node`) |
| `garage-bootstrap` | импортирует ключ приложения, создаёт бакеты, выдаёт доступ |
| `garage-lifecycle` | применяет правила жизненного цикла через S3 API |

---

## 👨‍💻 Настройка для разработки

<details>
<summary><b>🔧 Dev-стенд с горячей перезагрузкой</b></summary>

Включённый в репозиторий оверрайд `.dev` монтирует исходники в контейнеры и включает
polling вотчеров. Он также публикует PostgreSQL на `5431` — это **необходимо для миграций**.

```bash
# Linux / macOS
cp docker-compose.override.yml{.dev,}
```

```powershell
# Windows PowerShell
PS> Copy-Item docker-compose.override.yml.dev docker-compose.override.yml
```

```bash
docker compose up -d --build
```

Дальше правьте `backend/` или `frontend/` и просто ждите перезагрузки.

</details>

<details>
<summary><b>🪢 Git-хуки (линтинг, форматирование, коммиты)</b></summary>

Все хуки описаны в едином корневом `.pre-commit-config.yaml`.

```bash
npm install                  # commitlint для хука commit-msg
pip install pre-commit
pre-commit install --hook-type pre-commit --hook-type commit-msg
```

| Хук | Область |
|---|---|
| `check-yaml`, `check-json`, `check-toml`, `end-of-file-fixer`, `trailing-whitespace` | весь репозиторий |
| `black`, `ruff`, `pytest` | `backend/**.py` |
| `black`, `ruff`, `pytest` | `processing/**.py` |
| `eslint --fix`, `prettier --write` | `frontend/**` |

> ⚠️ Python-хуки вызывают исполняемый файл `python`. Если у вас `python3` или `py` —
> настройте алиас.

Коммиты следуют [Conventional Commits](https://www.conventionalcommits.org/) и
проверяются через `commitlint.config.js`.

</details>

<details>
<summary><b>🐍 Локальный запуск тестов и проверок</b></summary>

Тесты можно запускать локально. Backend-тесты используют **testcontainers**, поэтому
нужен запущенный Docker-*демон* (поднимаются одноразовые PostgreSQL и Redis).

```bash
# backend
poetry -C backend install
poetry -C backend run pytest
poetry -C backend run black --check .
poetry -C backend run ruff check .

# processing
poetry -C processing install
poetry -C processing run pytest -v
poetry -C processing run black --check src tests
poetry -C processing run ruff check src tests

# frontend
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run format
```

</details>

<details>
<summary><b>🗄️ Миграции Alembic</b></summary>

```bash
# при наличии оверрайда .dev (PostgreSQL опубликован на 5431)
./backend/makemigrations.sh "add foo column"
```

`test_migrations.py` выполняет `alembic upgrade head`, `downgrade base` и `alembic check`,
поэтому **изменение модели без миграции ломает тесты**.

</details>

<details>
<summary><b>🐳 Ограничения памяти</b></summary>

По умолчанию лимитов нет. Чтобы их задать, скопируйте
`docker-compose.override.yml.memlim` в `docker-compose.override.yml` и подстройте значения.

</details>

---

## 🔐 Переменные окружения

Как правило, вам нужно трогать только переменные, помеченные как **Обязательные**.

| **Переменная**                | **Описание**                                                                                                                             | **Обязательно** | **По умолчанию**     |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|----------------|----------------------|
| **Приложение**                |                                                                                                                                             |                |                      |
| `DEBUG`                       | Режим отладки. Включает небезопасные cookie. Отключается значением `0`, `no` или `false`; любое другое значение включает.                   | ✅             | `1`                  |
| `BACKEND_URL`                 | Публичный URL бэкенда, куда ходят клиенты. Встраивается в сборку фронтенда и используется бэкендом.                                        | ✅             | `http://localhost:3000` |
| `FRONTEND_URL`                | Публичный URL фронтенда, используется бэкендом (например, для CORS и редиректов).                                                          | ✅             | `http://localhost:8080` |
| `BACKEND_PORT`                | Порт, на котором работает бэкенд.                                                                                                          | ❌             | `3000`               |
| `FRONTEND_PORT`               | Порт, на котором работает фронтенд.                                                                                                        | ❌             | `8080`               |
| `TEST_INSTANCE_MODE`          | Предохранитель. Если истинно (`true`, `yes`, `1`), разрушающие операции админа возвращают HTTP `450` вместо выполнения.                     | ❌             | `false`              |
| **База данных (PostgreSQL)**  |                                                                                                                                             |                |                      |
| `POSTGRES_PASSWORD`           | Пароль БД. Задайте надёжное значение; генерация — `openssl rand -hex 48`.                                                                 | ✅             |                      |
| `POSTGRES_USER`               | Пользователь БД.                                                                                                                            | ❌             | `divaldi`            |
| `POSTGRES_DB`                 | Имя базы данных.                                                                                                                           | ❌             | `divaldi`            |
| **Брокер (RabbitMQ)**         |                                                                                                                                             |                |                      |
| `RABBITMQ_PASS`               | Пароль панели RabbitMQ.                                                                                                                     | ✅             |                      |
| `RABBITMQ_USER`               | Пользователь панели RabbitMQ.                                                                                                               | ❌             | `admin`              |
| `RABBITMQ_MANAGEMENT_PORT`    | Порт веб-интерфейса RabbitMQ.                                                                                                               | ❌             | `15672`              |
| **Мониторинг (TaskIQ)**       |                                                                                                                                             |                |                      |
| `TASKIQ_API_TOKEN`            | Секрет панели TaskIQ.                                                                                                                       | ✅             |                      |
| `TASKIQ_DASHBOARD_PORT`       | Порт панели TaskIQ.                                                                                                                         | ❌             | `8000`               |
| **GigaChat (Sber)**           |                                                                                                                                             |                |                      |
| `SBER_API_KEY`                | API-ключ из [документации Сбера](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).                                 | ✅             | `mock`               |
| `SBER_API_SCOPE`              | Область действия API из [документации Сбера](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token). Одно из: `PERS`, `B2B`, `CORP`. | ✅         | `PERS`               |
| `GIGACHAT_MODEL`              | Используемая модель GigaChat. См. [модели GigaChat](https://developers.sber.ru/docs/ru/gigachat/models/main).                                | ❌             | `GigaChat-3-Ultra`   |
| **Объектное хранилище (Garage)** |                                                                                                                                           |                |                      |
| `S3_SECRET_KEY`               | Секрет S3-ключа приложения. ⚠️ Garage открыт в продакшене — слабый секрет приведёт к серьёзным проблемам безопасности. Генерируйте через `openssl rand -hex 48`. | ✅             |                      |
| `S3_ACCESS_KEY`               | Id ключа, который импортирует `garage-bootstrap`. Формат: `GK` + 26 hex-символов. ⚠️ Нельзя использовать с другим секретом, поэтому при ротации секрета нужен новый id. | ❌             | `GKd1a1b2c3d4e5f60718293a4b5c6d` |
| `S3_PUBLIC_URL`               | Endpoint, зашитый в presigned-ссылки, поэтому должен быть доступен из браузера. ОБЯЗАТЕЛЬНО ОБНОВИТЕ В ПРОДАКШЕНЕ.                              | ❌             | `http://localhost:3900` |
| `S3_PORT`                     | Хостовый порт S3 API.                                                                                                                      | ❌             | `3900`               |
| `S3_REGION`                   | Должно совпадать с `s3_region` в `conf/garage.toml`.                                                                                       | ❌             | `garage`             |
| `GARAGE_RPC_SECRET`           | RPC-секрет Garage. ⚠️ Ровно **32 байта в hex** — используйте `openssl rand -hex 32`, а не `-hex 48`, иначе Garage не стартует.              | ✅             |                      |
| `GARAGE_ADMIN_TOKEN`          | Токен admin API Garage. То же ограничение в 32 байта, что и у `GARAGE_RPC_SECRET`.                                                        | ✅             |                      |
| `GARAGE_ADMIN_PORT`           | Хостовый порт admin API Garage.                                                                                                             | ❌             | `3903`               |

> 🔐 **Имена хостов Redis, RabbitMQ, Garage и панели TaskIQ захардкожены** в бэкенде
> (`redis://redis:6379`, `amqp://…@rabbitmq:5672/taskiq`, `http://garage:3900`,
> `http://taskiq_dashboard:8000`). Это ещё одна причина, почему приложение работает
> только в Compose.

### 🧠 Разделение баз Redis

| БД | Назначение |
|---|---|
| `/0` | общее — кэш, блокировки, лимиты, статусы |
| `/1` | результаты задач TaskIQ |

---

## 🛡️ Заметки по безопасности

- 🔑 Пароли хешируются **argon2-cffi**; сессии — непрозрачные случайные токены
  (`httponly`, `samesite=lax`, `secure` вне `DEBUG`, срок 7 дней) — **не JWT**.
- 📚 `/api/v1/docs`, `/redoc` и `openapi.json` доступны **только при включённом `DEBUG`**.
- 🚦 `TEST_INSTANCE_MODE` блокирует разрушающие операции администратора
  нестандартным кодом **HTTP 450**.
- 🧨 В системный промпт встроена **защита от prompt injection**: агенту предписано
  воспринимать инструкции внутри загруженных файлов как атаку, предупреждать
  пользователя и отказываться от посторонних тем.
- 🔒 Origins для CORS берутся из `FRONTEND_URL` / `BACKEND_URL` и лишь в debug
  откатываются к `*`.

---

## 👥 Ответственные за код

| Путь | Ответственный |
|---|---|
| `/backend/`, `/scripts/`, `/.github/`, `docker-compose.yaml`, `.env.example` | @yel-gar |
| `/frontend/` | @krchvl |
| `/processing/` | @AX-Ray |

См. [`.github/CODEOWNERS`](.github/CODEOWNERS).

<details>
<summary><b>🎭 End-to-end тесты (Playwright)</b></summary>

E2E-набор работает с реальным стеком Compose — браузер, FastAPI, воркеры TaskIQ,
PostgreSQL, Redis, Garage — с **`SBER_API_KEY=mock`**, поэтому весь путь запроса
проверяется, а сама языковая модель работает офлайн и бесплатно.

```bash
./e2e/scripts/run.sh
```

Стек поднимается на порту **18080** (чтобы не конфликтовать с уже запущенным dev-стеком),
создаётся суперпользователь `e2e`, затем запускаются тесты из `e2e/`.

Запуск в интерактивном режиме:

```bash
./e2e/scripts/setup.sh
cd e2e && npx playwright install chromium
npx playwright test --ui
```

</details>

---

## 🤖 Для ИИ-агентов

Работаете с репозиторием? Начните с этих файлов:

| Файл | Назначение |
|---|---|
| [`AGENTS.md`](AGENTS.md) | обязательный харнесс — соглашения, команды, правила |
| [`.context/DECISIONS.md`](.context/DECISIONS.md) | почему архитектура именно такая |
| [`.context/LESSONS.md`](.context/LESSONS.md) | грабли, на которые уже наступали |
| [`.context/PROJECT_STATE.md`](.context/PROJECT_STATE.md) | состояние проекта на текущий момент |
| [`.agents/skills/`](.agents/skills) | пошаговые инструкции под конкретные задачи |

---

<div align="center">

**Сделано с 🛠️ для инженеров ООО НПО «Энергон»**

*Лицензия репозитория: проприетарная.*

</div>
