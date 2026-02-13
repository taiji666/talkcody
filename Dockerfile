# TalkCody API Service Dockerfile
# For fly.io deployment
# Build from project root: docker build -f Dockerfile .

# Use Rust official image
FROM rust:1-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libsqlite3-dev \
    libglib2.0-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    cmake \
    clang \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy src-tauri files (Rust project root)
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/build.rs ./src-tauri/build.rs
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
COPY src-tauri/tauri.conf.dev.json ./src-tauri/tauri.conf.dev.json
COPY src-tauri/capabilities ./src-tauri/capabilities
COPY src-tauri/icons ./src-tauri/icons
COPY src-tauri/src ./src-tauri/src

# Copy files referenced by include_str! macro (need to be at project root)
COPY packages/shared/src/data/models-config.json ./packages/shared/src/data/models-config.json
COPY src/services/codex-instructions.md ./src/services/codex-instructions.md

# Set working directory to src-tauri for build
WORKDIR /app/src-tauri

# Generate Cargo.lock
RUN cargo generate-lockfile

# Build the API service binary
RUN cargo build --release --bin api_service

# Final stage - minimal runtime image
# Use testing to match GLIBC version with rust:1-slim builder
FROM debian:testing-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libsqlite3-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libwebkit2gtk-4.1-0 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

# Create data directories
RUN mkdir -p /data/talkcody /data/workspace && chown -R appuser:appuser /data

# Copy binary from builder
COPY --from=builder /app/src-tauri/target/release/api_service /usr/local/bin/api_service

# Set ownership
RUN chown appuser:appuser /usr/local/bin/api_service

# Switch to non-root user
USER appuser

# Set environment variables with defaults
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_ROOT=/data/talkcody
ENV WORKSPACE_ROOT=/data/workspace

# Expose port
EXPOSE 8080

# Run the service
CMD ["api_service"]
