#!/data/data/com.termux/files/usr/bin/bash
# Dependency-free Termux supervisor for the local WhatsApp Scrapper web service.
# Usage: bash scripts/termux-service.sh start|status|stop|restart|logs
set -u

PROJECT_DIR="${WA_PROJECT_DIR:-$HOME/Whatsapp-scrapper}"
STATE_DIR="${WA_TERMUX_STATE_DIR:-$HOME/.whatsapp-scrapper-termux}"
PID_FILE="$STATE_DIR/supervisor.pid"
STOP_FILE="$STATE_DIR/stop.requested"
LOG_FILE="$STATE_DIR/server.log"
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"

mkdir -p "$STATE_DIR" || exit 1

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

status() {
  if [ -f "$PID_FILE" ] && alive "$(cat "$PID_FILE" 2>/dev/null)"; then
    echo "RUNNING supervisor_pid=$(cat "$PID_FILE")"
  else
    echo "STOPPED"
    return 1
  fi
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://$HOST:$PORT/healthz" >/dev/null 2>&1; then
    echo "HEALTHCHECK healthy ( /healthz )"
  elif command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://$HOST:$PORT/" >/dev/null 2>&1; then
    echo "HTTP reachable at http://$HOST:$PORT/"
  else
    echo "HTTP not confirmed yet; inspect logs with: bash scripts/termux-service.sh logs"
  fi
}

run_supervisor() {
  cd "$PROJECT_DIR" || { echo "Project folder not found: $PROJECT_DIR"; exit 2; }
  rm -f "$STOP_FILE"
  echo "$$" > "$PID_FILE"
  trap 'touch "$STOP_FILE"; rm -f "$PID_FILE"' EXIT INT TERM HUP
  echo "[$(date -Iseconds)] supervisor started; project=$PROJECT_DIR port=$PORT" >> "$LOG_FILE"
  while [ ! -f "$STOP_FILE" ]; do
    echo "[$(date -Iseconds)] starting node src/server.js" >> "$LOG_FILE"
    WA_ALLOW_FILE_ORIGIN="${WA_ALLOW_FILE_ORIGIN:-1}" PORT="$PORT" HOST="$HOST" node src/server.js >> "$LOG_FILE" 2>&1
    rc=$?
    [ -f "$STOP_FILE" ] && break
    echo "[$(date -Iseconds)] server exited rc=$rc; retrying in 5 seconds" >> "$LOG_FILE"
    sleep 5
  done
  echo "[$(date -Iseconds)] supervisor stopped" >> "$LOG_FILE"
}

start() {
  if [ ! -f "$PROJECT_DIR/src/server.js" ]; then
    echo "Project server not found: $PROJECT_DIR/src/server.js"
    echo "Set WA_PROJECT_DIR if your project is in another directory."
    exit 2
  fi
  if [ -f "$PID_FILE" ] && alive "$(cat "$PID_FILE" 2>/dev/null)"; then
    echo "Already running (pid $(cat "$PID_FILE"))."
    status || true
    exit 0
  fi
  rm -f "$STOP_FILE" "$PID_FILE"
  nohup bash "$0" __run >> "$LOG_FILE" 2>&1 </dev/null &
  echo "Starting supervisor (pid $!)."
  for _ in 1 2 3 4 5; do
    sleep 1
    if [ -f "$PID_FILE" ] && alive "$(cat "$PID_FILE" 2>/dev/null)"; then
      echo "Supervisor started. Logs: $LOG_FILE"
      echo "Open on this phone: http://127.0.0.1:$PORT"
      exit 0
    fi
  done
  echo "Supervisor did not confirm startup. Inspect logs: $LOG_FILE"
  exit 1
}

stop() {
  local pid child i
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if ! alive "$pid"; then
    rm -f "$PID_FILE" "$STOP_FILE"
    echo "Already stopped."
    exit 0
  fi
  touch "$STOP_FILE"
  child="$(pgrep -P "$pid" 2>/dev/null | head -n 1 || true)"
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null || true
  for i in 1 2 3 4 5; do
    alive "$pid" || break
    sleep 1
  done
  if alive "$pid"; then kill -TERM "$pid" 2>/dev/null || true; fi
  rm -f "$PID_FILE" "$STOP_FILE"
  echo "Stop requested. Check logs if the service does not exit: $LOG_FILE"
}

case "${1:-status}" in
  start) start ;;
  status) status ;;
  stop) stop ;;
  restart) stop; start ;;
  logs) tail -n 100 -f "$LOG_FILE" ;;
  __run) run_supervisor ;;
  *) echo "Usage: bash scripts/termux-service.sh {start|status|stop|restart|logs}"; exit 64 ;;
esac
