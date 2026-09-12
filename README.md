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

| **Variable**             | **Description**                                                                                                                                          | **Required** | **Default**           |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|-----------------------|
| DEBUG                    | Set debug mode for app, debug allows insecure cookies. Set to one of `0, no, false` to disable, otherwise it's enabled.                                  | ✅           | 1                     |
| BACKEND_URL              | Deployed backend URL where clients will make requests to. Injected into the frontend build and used by the backend.                                      | ✅           | http://localhost:3000 |
| FRONTEND_URL             | Deployed frontend URL used by the backend (e.g. for CORS / redirects).                                                                                   | ✅           | http://localhost:8080 |
| FRONTEND_PORT            | Port on which frontend will run.                                                                                                                         | ❌           | 8080                  |
| BACKEND_PORT             | Port on which backend will run.                                                                                                                          | ❌           | 3000                  |
| POSTGRES_USER            | Database user.                                                                                                                                           | ❌           | divaldi               |
| POSTGRES_DB              | Database name.                                                                                                                                           | ❌           | divaldi               |
| POSTGRES_PASSWORD        | Database password. Set it to something secure, you can get a secret with `openssl rand -hex 48`.                                                         | ✅           |                       |
| RABBITMQ_USER            | User for RabbitMQ admin panel                                                                                                                            | ❌           | admin                 |
| RABBITMQ_PASS            | Password for RabbitMQ admin panel                                                                                                                        | ✅           |                       |
| RABBITMQ_MANAGEMENT_PORT | Port on which RabbitMQ management interface will run                                                                                                     | ❌           | 15672                 |
| TASKIQ_API_TOKEN         | Secret for TaskIQ dashboard                                                                                                                              | ✅           |                       |
| TASKIQ_DASHBOARD_PORT    | Port on which TaskIQ management dashboard will run                                                                                                       | ❌           | 8000                  |
| GIGACHAT_MODEL           | GigaChat model used. Consult [Sber website](https://developers.sber.ru/docs/ru/gigachat/models/main) for more info                                       | ❌           | GigaChat-3-Ultra      |
| SBER_API_KEY             | API Key from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).                                               | ✅           | mock                  |
| SBER_API_SCOPE           | API scope from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token). One of the following: `PERS`, `B2B`, `CORP` | ✅           | PERS                  |
| MINIO_ROOT_USER          | MinIO user.                                                                                                                                              | ❌           | minio                 |
| MINIO_ROOT_PASSWORD      | MinIO password. ⚠️ **WARNING**: MinIO is open in production, so if this password is weak, you could face severe security issues.                         | ✅           |                       |
| MINIO_PORT               | Production port where MinIO will run.                                                                                                                    | ❌           | 9000                  |
| MINIO_DASHBOARD_PORT     | MinIO dashboard port.                                                                                                                                    | ❌           | 9001                  |
| MINIO_URL                | Public base URL of MinIO.                                                                                                                                | ✅           | http://localhost:9000 |

## Redis designation
`/0` - general
`/1` - task results
