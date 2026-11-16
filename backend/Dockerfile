# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
# Migrations are embedded with sqlx::migrate!, so no database is needed at build time.
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /app workapos

WORKDIR /app
COPY --from=builder /build/target/release/workapos-hq /usr/local/bin/workapos-hq
COPY web ./web
COPY migrations ./migrations

RUN mkdir -p /app/uploads && chown -R workapos:workapos /app
USER workapos

ENV BIND_ADDR=0.0.0.0:8080 \
    WEB_DIR=/app/web \
    UPLOAD_DIR=/app/uploads \
    SEED_DEMO=1 \
    RUST_LOG=workapos_hq=info,tower_http=info,sqlx=warn

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["workapos-hq"]
