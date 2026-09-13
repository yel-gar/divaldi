# Divaldi
## Setup Instruction
1. Clone our repo
```bash
$ git clone https://github.com/yel-gar/divaldi.git
```

2. Copy the `.env.example` to `.env`
```bash
# Linux
$ cp .env{.example,}
```
```powershell
# Windows
PS> Copy-Item .env.example .env
```

3. Edit the `.env` file with actual variables according to [this table](#environment-variables)
4. Launch the project
```bash
$ docker compose up -d --build
```

5. Verify everything started up successfully
```bash
$ docker compose logs -f
```

6. Create superuser
```bash
# Linux
$ chmod +x createsuperuser.sh
$ ./createsuperuser.sh
```

```powershell
# Windows
PS> .\createsuperuser.ps1
```

7. You're all set 🤙

---

## Developers setup
1. Install dev dependencies and pre-commit (this repo uses it for all linting/formatting hooks *and* commit message checks — no Node tooling required just for hooks)
```bash
$ npm install
$ pip install pre-commit
```

2. Install the git hooks
```bash
$ pre-commit install --hook-type pre-commit --hook-type commit-msg
```
This registers two things: a `pre-commit` hook that lints/formats only the files you've staged, and a `commit-msg` hook that checks your commit message against [Conventional Commits](https://www.conventionalcommits.org/). Both are defined in the single root [`.pre-commit-config.yaml`](.pre-commit-config.yaml).
> **IMPORTANT**: in the hooks we use `python` executable, if you have `python3` or `py`, please set up an alias for the environment.

3. Configure environment vars
```bash
$ cp .env{.example,}
```
```powershell
PS> Copy-Item .env.example .env
```

4. Open compose database port via override (required for migrations)
```bash
$ cp docker-compose.override.yml{.dev,}
```

```powershell
PS> Copy-Item docker-compose.override.yml.dev docker-compose.override.yml
```

## Environment Variables
You should generally only touch variables marked as **Required**.

| **Variable**                  | **Description**                                                                                                                             | **Required** | **Default**             |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|--------------|-------------------------|
| **Application**               |                                                                                                                                             |              |                         |
| `DEBUG`                       | Set debug mode for app. Debug allows insecure cookies. Set to one of `0, no, false` to disable; anything else enables it.                   | ✅           | `1`                     |
| `BACKEND_URL`                 | Deployed backend URL where clients make requests. Injected into the frontend build and used by the backend.                                 | ✅           | `http://localhost:3000` |
| `FRONTEND_URL`                | Deployed frontend URL used by the backend (e.g. for CORS / redirects).                                                                      | ✅           | `http://localhost:8080` |
| `BACKEND_PORT`                | Port on which backend runs.                                                                                                                 | ❌           | `3000`                  |
| `FRONTEND_PORT`               | Port on which frontend runs.                                                                                                                | ❌           | `8080`                  |
| **Database (PostgreSQL)**     |                                                                                                                                             |              |                         |
| `POSTGRES_PASSWORD`           | Database password. Set to something secure; generate with `openssl rand -hex 48`.                                                           | ✅           |                         |
| `POSTGRES_USER`               | Database user.                                                                                                                              | ❌           | `divaldi`               |
| `POSTGRES_DB`                 | Database name.                                                                                                                              | ❌           | `divaldi`               |
| **Message broker (RabbitMQ)** |                                                                                                                                             |              |                         |
| `RABBITMQ_PASS`               | Password for RabbitMQ admin panel.                                                                                                          | ✅           |                         |
| `RABBITMQ_USER`               | User for RabbitMQ admin panel.                                                                                                              | ❌           | `admin`                 |
| `RABBITMQ_MANAGEMENT_PORT`    | Port on which RabbitMQ management interface runs.                                                                                           | ❌           | `15672`                 |
| **Task monitoring (TaskIQ)**  |                                                                                                                                             |              |                         |
| `TASKIQ_API_TOKEN`            | Secret for TaskIQ dashboard.                                                                                                                | ✅           |                         |
| `TASKIQ_DASHBOARD_PORT`       | Port on which TaskIQ dashboard runs.                                                                                                        | ❌           | `8000`                  |
| **GigaChat (Sber)**           |                                                                                                                                             |              |                         |
| `SBER_API_KEY`                | API key from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).                                  | ✅           | `mock`                  |
| `SBER_API_SCOPE`              | API scope from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token). One of: `PERS`, `B2B`, `CORP`. | ✅           | `PERS`                  |
| `GIGACHAT_MODEL`              | GigaChat model used. See [Sber models docs](https://developers.sber.ru/docs/ru/gigachat/models/main).                                       | ❌           | `GigaChat-3-Ultra`      |
| **Object storage (MinIO)**    |                                                                                                                                             |              |                         |
| `MINIO_ROOT_PASSWORD`         | MinIO password. ⚠️ MinIO is exposed in production — a weak password here can cause severe security issues.                                  | ✅           |                         |
| `MINIO_URL`                   | Public base URL of MinIO.                                                                                                                   | ✅           | `http://localhost:9000` |
| `MINIO_ROOT_USER`             | MinIO user.                                                                                                                                 | ❌           | `minio`                 |
| `MINIO_PORT`                  | Production port where MinIO runs.                                                                                                           | ❌           | `9000`                  |
| `MINIO_DASHBOARD_PORT`        | MinIO dashboard port.                                                                                                                       | ❌           | `9001`                  |
## Redis designation
`/0` - general
`/1` - task results
