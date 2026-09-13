FROM python:3.14-alpine
RUN apk add --no-cache libstdc++
RUN pip install poetry==2.4.3 uvicorn==0.52.4
COPY backend/pyproject.toml backend/poetry.lock /app/
WORKDIR /app

COPY processing/ /processing/
RUN poetry install --only main --no-root
COPY backend/ .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
