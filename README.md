# Divaldi

## Developers setup
### Global
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

| **Variable**      | **Description**                                                                                                         | **Required** | **Default**           |
|-------------------|-------------------------------------------------------------------------------------------------------------------------|--------------|-----------------------|
| DEBUG             | Set debug mode for app, debug allows insecure cookies. Set to one of `0, no, false` to disable, otherwise it's enabled. | ✅           | 1                     |
| BACKEND_URL       | Deployed backend URL where clients will make requests to. Injected into the frontend build and used by the backend.     | ✅           | http://localhost:3000 |
| FRONTEND_URL      | Deployed frontend URL used by the backend (e.g. for CORS / redirects).                                                  | ❌           | http://localhost:8080 |
| FRONTEND_PORT     | Port on which frontend will run.                                                                                        | ❌           | 8080                  |
| BACKEND_PORT      | Port on which backend will run.                                                                                         | ❌           | 3000                  |
| POSTGRES_USER     | Database user.                                                                                                          | ❌           | divaldi               |
| POSTGRES_DB       | Database name.                                                                                                          | ❌           | divaldi               |
| POSTGRES_PASSWORD | Database password. Set it to something secure, you can get a secret with `openssl rand -hex 48`.                        | ✅           |                       |
