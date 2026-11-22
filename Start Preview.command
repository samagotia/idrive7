#!/bin/bash
set -eu
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export BENCH_PORT="${BENCH_PORT:-8078}"
preview_url="http://127.0.0.1:$BENCH_PORT"

if ! command -v node >/dev/null || ! command -v python3 >/dev/null; then
    echo 'Samagotia Clusters needs Node.js and Python 3.'
    exit 1
fi

studio_ready() {
    /usr/bin/curl --noproxy '*' --max-time 1 -fs "$preview_url/studio-status" |
        python3 -c 'import json,sys; s=json.load(sys.stdin); sys.exit(0 if s.get("studio")=="m4-cluster-studio" and s.get("app")=="samagotia_clusters" and s.get("running") is True else 1)' 2>/dev/null
}

open_preview() {
    echo "Samagotia Clusters is ready at $preview_url"
    if [[ "${M4_STUDIO_NO_OPEN:-0}" != 1 ]]; then
        /usr/bin/open "$preview_url"
    fi
}

if studio_ready; then
    open_preview
    exit 0
fi

node bench/server.js samagotia_clusters &
studio_pid=$!
trap 'kill "$studio_pid" 2>/dev/null || true' EXIT
trap 'exit 0' INT TERM

for attempt in {1..60}; do
    if studio_ready; then
        open_preview
        echo 'Press Control-C in this window to stop the preview.'
        wait "$studio_pid"
        exit 0
    fi
    if ! kill -0 "$studio_pid" 2>/dev/null; then
        echo 'Could not start Samagotia Clusters. Check the message above.'
        exit 1
    fi
    sleep 0.2
done

echo 'The preview did not become ready. Check the message above.'
exit 1
