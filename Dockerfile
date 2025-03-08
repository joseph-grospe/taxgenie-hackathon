FROM python:3.11 AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN pip install uv

# Create a virtual environment with uv
RUN uv venv .venv

COPY pyproject.toml ./
# Use the virtual environment to install dependencies
RUN uv pip install --no-cache . --python=.venv/bin/python

FROM python:3.11-slim
WORKDIR /app

# Install Poppler utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

RUN pip install uv

COPY --from=builder /app/.venv .venv/
COPY . .

# Use the virtual environment's Python to run the command
CMD [".venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
