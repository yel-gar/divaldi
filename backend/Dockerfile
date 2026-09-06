FROM python:3.13-alpine
RUN pip install poetry uvicorn
COPY pyproject.toml poetry.lock /app/
WORKDIR /app
RUN poetry install --only main --no-root
COPY /app /app/app
COPY entrypoint.sh /app/
CMD ["bash", "-c", "entrypoint.sh"]
