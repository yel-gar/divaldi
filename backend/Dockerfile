FROM python:3.14-alpine
RUN pip install poetry uvicorn
COPY pyproject.toml poetry.lock /app/
WORKDIR /app
RUN poetry install --only main --no-root
COPY . .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
