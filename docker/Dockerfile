# Multi-stage build for AiDiy2027
# Stage 1: Backend dependencies
FROM python:3-slim AS backend-builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend pyproject.toml
COPY backend_server/pyproject.toml /app/backend_server/

# Install Python dependencies from pyproject.toml
WORKDIR /app/backend_server
RUN pip install --no-cache-dir .

# Stage 2: Frontend build
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend_web

# Copy package files
COPY frontend_web/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend_web/ ./

# Build frontend
RUN npm run build

# Stage 3: Final runtime image
FROM python:3-slim

WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from builder
COPY --from=backend-builder /usr/local/lib /usr/local/lib
COPY --from=backend-builder /usr/local/bin /usr/local/bin

# Copy backend application
COPY backend_server/ /app/backend_server/

# Copy built frontend files
COPY --from=frontend-builder /app/frontend_web/dist /app/frontend_web/dist
COPY --from=frontend-builder /app/frontend_web/public /app/frontend_web/public

# Create necessary directories
RUN mkdir -p /app/temp /app/_data

# Expose ports
# 8090: Frontend
# 8091: Backend Core API (core_main)
# 8098: Backend Apps API (apps_main)
EXPOSE 8090 8091 8098

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://127.0.0.1:8091/docs || exit 1

# Start script
COPY docker/start.sh /app/
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
