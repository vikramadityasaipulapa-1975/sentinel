FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/payment-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY services/payment-service ./payment
ENV PYTHONPATH=/app/payment
COPY database ./database
COPY scripts/migrate.py ./scripts/migrate.py
ARG PAYMENT_VERSION=payment-v1
ARG SOURCE_SHA256=unknown
ARG GIT_COMMIT=unknown
LABEL sentinel.version=$PAYMENT_VERSION sentinel.source-sha256=$SOURCE_SHA256 sentinel.commit=$GIT_COMMIT
ENV PAYMENT_VERSION=$PAYMENT_VERSION SOURCE_SHA256=$SOURCE_SHA256 GIT_COMMIT=$GIT_COMMIT
USER 10001:10001
EXPOSE 3002
CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "payment", "--host", "0.0.0.0", "--port", "3002", "--no-access-log"]
