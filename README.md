# Divaldi

## Developers setup
### Global
1. Install commitlint and husky
```bash
$ npm install
$ npx husky init
```

2. Install pre-commit
```bash
$ pip install pre-commit
```

3. Set up hooks (works on Linux, macOS, and Windows)
```bash
$ node setup-hooks.js
```

4. Configure environment vars
```bash
$ cp .env{.example,}
```

5. Open compose database port via override (required for migrations)
```bash
$ cp docker-compose.override.yml{.dev,}
```

## Environment Variables
You should generally only touch variables marked as **Required**.

| **Variable**      | **Description**                                                                                                         | **Required** | **Default**           |
|-------------------|-------------------------------------------------------------------------------------------------------------------------|--------------|-----------------------|
| DEBUG             | Set debug mode for app, debug allows insecure cookies. Set to one of `0, no, false` to disable, otherwise it's enabled. | ✅           | 1                     |
| BACKEND_URL       | Deployed backend URL where clients will make requests to.                                                               | ✅           | http://localhost:3000 |
| FRONTEND_PORT     | Port on which frontend will run.                                                                                        | ❌           | 8080                  |
| BACKEND_PORT      | Port on which backend will run.                                                                                         | ❌           | 3000                  |
| POSTGRES_USER     | Database user.                                                                                                          | ❌           | divaldi               |
| POSTGRES_DB       | Database name.                                                                                                          | ❌           | divaldi               |
| POSTGRES_PASSWORD | Database password. Set it to something secure, you can get a secret with `openssl rand -hex 48`.                        | ✅           |                       |
