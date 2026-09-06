FROM python:3.13-alpine
RUN pip install poetry uvicorn
COPY pyproject.toml poetry.lock /app/
WORKDIR /app
RUN poetry install --only main --no-root
COPY /app /app/app
CMD ["poetry", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000", "--reload"]
