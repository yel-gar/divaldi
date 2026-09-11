FROM python:3.14-alpine
RUN pip install poetry uvicorn
COPY backend/pyproject.toml backend/poetry.lock /app/
WORKDIR /app

COPY processing/ /processing/
RUN poetry install --only main --no-root
COPY backend/ .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
