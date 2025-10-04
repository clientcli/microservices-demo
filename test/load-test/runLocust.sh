#!/bin/bash
#
# Run locust load test (modernized for Locust 2.x)
#
#####################################################################
ARGS="$@"
HOST="${1}"
SCRIPT_NAME=$(basename "$0")

INITIAL_DELAY=1
TARGET_HOST="$HOST"
USERS=2
SPAWN_RATE=1
RUN_TIME="1m"
LOCUST_FILE=${LOCUST_FILE:-"/config/locustfile.py"}
RESULTS_DIR=${RESULTS_DIR:-"/results"}

do_check() {
  # check hostname is not empty
  if [ -z "$TARGET_HOST" ]; then
    echo "TARGET_HOST is not set; use '-h hostname:port'"
    exit 1
  fi

  # check for locust
  if ! command -v locust >/dev/null 2>&1; then
    echo "Python 'locust' package is not found!"
    exit 1
  fi

  # check locust file is present
  if [ -f "$LOCUST_FILE" ]; then
    echo "Locust file: $LOCUST_FILE"
  else
    echo "ERROR: Locust file $LOCUST_FILE not found!"
    exit 1
  fi
}

do_exec() {
  sleep $INITIAL_DELAY

  echo "Will run $LOCUST_FILE against $TARGET_HOST"
  echo "Spawning $USERS users at $SPAWN_RATE users/sec for $RUN_TIME"
  echo "Results will be saved to $RESULTS_DIR"

  mkdir -p "$RESULTS_DIR"

  locust \
    -f "$LOCUST_FILE" \
    --headless \
    -u "$USERS" \
    -r "$SPAWN_RATE" \
    --run-time "$RUN_TIME" \
    --host "$TARGET_HOST" \
    --csv "$RESULTS_DIR/loadtest" \
    --html "$RESULTS_DIR/report.html" \
    --only-summary

  echo "✅ done"
}

do_usage() {
    cat >&2 <<EOF
Usage:
  ${SCRIPT_NAME} [ hostname ] OPTIONS

Options:
  -d  Delay before starting (seconds, default: 1)
  -h  Target host url, e.g. http://localhost/
  -c  Number of users (default: 2)
  -r  Spawn rate users/sec (default: 1)
  -t  Run time (default: 1m, e.g. 30s, 2m, 5m)

Environment variables:
  LOCUST_FILE   Path to locustfile.py (default: /config/locustfile.py)
  RESULTS_DIR   Directory for results (default: /results)

Description:
  Runs a Locust load simulation against specified host.
  Generates CSV and HTML reports in RESULTS_DIR.

EOF
  exit 1
}

while getopts ":d:h:c:r:t:" o; do
  case "${o}" in
    d)
        INITIAL_DELAY=${OPTARG}
        ;;
    h)
        TARGET_HOST=${OPTARG}
        ;;
    c)
        USERS=${OPTARG:-2}
        ;;
    r)
        SPAWN_RATE=${OPTARG:-1}
        ;;
    t)
        RUN_TIME=${OPTARG:-1m}
        ;;
    *)
        do_usage
        ;;
  esac
done

do_check
do_exec
