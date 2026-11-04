#!/bin/bash
# AiDiy2027 Docker Startup Script

set -e  # Exit on error

PORT_WEB=8090
PORT_CORE=8091
PORT_APPS=8098

echo "=========================================="
echo "  AiDiy2027 Starting..."
echo "=========================================="

cd /app

# Start Backend Core API (core_main) in background
echo "[1/3] Starting Backend Core API (port ${PORT_CORE})..."
cd /app/backend_server
python -m uvicorn core_main:app --host 0.0.0.0 --port "${PORT_CORE}" --log-level info --ws-max-size "${UVICORN_WS_MAX_SIZE:-20971520}" &
CORE_PID=$!
sleep 2

# Start Backend Apps API (apps_main) in background
echo "[2/3] Starting Backend Apps API (port ${PORT_APPS})..."
python -m uvicorn apps_main:app --host 0.0.0.0 --port "${PORT_APPS}" --log-level info --ws-max-size "${UVICORN_WS_MAX_SIZE:-20971520}" &
APPS_PID=$!
sleep 2

# Start Frontend server with simple HTTP server
echo "[3/3] Starting Frontend (port ${PORT_WEB})..."
cd /app/frontend_web/dist
python -m http.server "${PORT_WEB}" &
FRONTEND_PID=$!

echo ""
echo "=========================================="
echo "  AiDiy2027 Started Successfully!"
echo "=========================================="
echo ""
echo "Services:"
echo "  - Frontend:    http://127.0.0.1:${PORT_WEB}"
echo "  - Core API:    http://127.0.0.1:${PORT_CORE}/docs"
echo "  - Apps API:    http://127.0.0.1:${PORT_APPS}/docs"
echo ""
echo "Default Login:"
echo "  - Username: admin"
echo "  - Password: (check README.md)"
echo ""
echo "Press Ctrl+C to stop all services..."
echo ""

# Trap SIGTERM and SIGINT to gracefully stop all processes
trap "echo 'Stopping services...'; kill $CORE_PID $APPS_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# Wait for all background processes
wait $CORE_PID $APPS_PID $FRONTEND_PID
