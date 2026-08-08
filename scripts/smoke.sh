#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test: exercises every documented agentwiki command against
# a throwaway HOME and vault.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
MAIN="$ROOT/src/main.ts"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep)
      KEEP=1
      ;;
    *)
      echo "Unknown smoke.sh option: $arg" >&2
      exit 2
      ;;
  esac
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/agentwiki-smoke.XXXXXX")"
export HOME="$TMP/home"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"
export AGENTWIKI_VAULT="$TMP/vault"
mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$AGENTWIKI_VAULT"

ERR_TMP="$TMP/last-stderr"
: >"$ERR_TMP"

STEP="<init>"
SERVE_PID=""

cleanup() {
  local status=$?
  if [[ -n "$SERVE_PID" ]] && kill -0 "$SERVE_PID" 2>/dev/null; then
    kill "$SERVE_PID" 2>/dev/null || true
    wait "$SERVE_PID" 2>/dev/null || true
  fi
  if (( KEEP )); then
    echo "Kept smoke workspace at: $TMP"
  else
    rm -rf -- "$TMP"
  fi
  exit "$status"
}
trap cleanup EXIT

on_error() {
  echo "SMOKE FAILED (unexpected error) at step: $STEP (line $1)" >&2
  exit 1
}
trap 'on_error $LINENO' ERR

step() {
  STEP="$1"
  echo
  echo "== $STEP =="
}

fail() {
  echo "SMOKE FAILED at step: $STEP" >&2
  echo "$1" >&2
  exit 1
}

have_jq() {
  command -v jq >/dev/null 2>&1
}

wiki() {
  bun "$MAIN" "$@"
}

# Runs `wiki "$@"`, capturing stdout/stderr/status into LAST_STDOUT,
# LAST_STDERR, LAST_STATUS without tripping errexit. Echoes the command and
# its output as it goes, per the "show output" requirement.
run() {
  echo "+ agentwiki $*"
  set +e
  LAST_STDOUT="$(wiki "$@" 2>"$ERR_TMP")"
  LAST_STATUS=$?
  set -e
  LAST_STDERR="$(cat "$ERR_TMP" 2>/dev/null || true)"
  : >"$ERR_TMP"
  [[ -n "$LAST_STDOUT" ]] && printf '%s\n' "$LAST_STDOUT"
  [[ -n "$LAST_STDERR" ]] && printf '%s\n' "$LAST_STDERR" >&2
  return 0
}

# Same as run(), but pipes $1 to stdin (for `add` reading a document body
# from stdin rather than a file argument).
run_stdin() {
  local content="$1"
  shift
  echo "+ agentwiki $* (stdin content piped)"
  set +e
  LAST_STDOUT="$(printf '%s' "$content" | wiki "$@" 2>"$ERR_TMP")"
  LAST_STATUS=$?
  set -e
  LAST_STDERR="$(cat "$ERR_TMP" 2>/dev/null || true)"
  : >"$ERR_TMP"
  [[ -n "$LAST_STDOUT" ]] && printf '%s\n' "$LAST_STDOUT"
  [[ -n "$LAST_STDERR" ]] && printf '%s\n' "$LAST_STDERR" >&2
  return 0
}

expect_status() {
  local expected="$1"
  [[ "$LAST_STATUS" == "$expected" ]] || fail "expected exit $expected, got $LAST_STATUS"
}

expect_stdout_empty() {
  [[ -z "$LAST_STDOUT" ]] || fail "expected empty stdout, got: $LAST_STDOUT"
}

assert_contains() {
  local haystack="$1" needle="$2" what="$3"
  [[ "$haystack" == *"$needle"* ]] || fail "expected $what to contain: $needle"
}

assert_not_contains() {
  local haystack="$1" needle="$2" what="$3"
  [[ "$haystack" != *"$needle"* ]] || fail "expected $what to NOT contain: $needle"
}

assert_ok_true() {
  if have_jq; then
    printf '%s' "$LAST_STDOUT" | jq -e '.ok == true' >/dev/null 2>&1 \
      || fail "expected ok:true envelope, got: $LAST_STDOUT"
  else
    assert_contains "$LAST_STDOUT" '"ok":true' "envelope"
  fi
}

assert_ok_false() {
  if have_jq; then
    printf '%s' "$LAST_STDOUT" | jq -e '.ok == false' >/dev/null 2>&1 \
      || fail "expected ok:false envelope, got: $LAST_STDOUT"
  else
    assert_contains "$LAST_STDOUT" '"ok":false' "envelope"
  fi
}

assert_error_code() {
  local code="$1"
  if have_jq; then
    printf '%s' "$LAST_STDOUT" | jq -e --arg c "$code" '.error.code == $c' >/dev/null 2>&1 \
      || fail "expected error code \"$code\", got: $LAST_STDOUT"
  else
    assert_contains "$LAST_STDOUT" "\"code\":\"$code\"" "error code"
  fi
}

assert_curl_ok() {
  local url="$1" label="$2"
  echo "+ curl -fsS $url"
  if ! curl -fsS "$url" >"$TMP/curl-out" 2>"$TMP/curl-err"; then
    cat "$TMP/curl-err" >&2
    fail "curl failed for $label: $url"
  fi
  echo "  -> $(wc -c <"$TMP/curl-out" | tr -d ' ') bytes"
}

echo "agentwiki smoke test"
echo "workspace: $TMP"
echo "vault:     $AGENTWIKI_VAULT"

# --- top-level agent surface -------------------------------------------------

step "--agent-teaser"
run --agent-teaser
expect_status 0
[[ -n "$LAST_STDOUT" ]] || fail "expected non-empty --agent-teaser output"

step "--agent-help"
run --agent-help
expect_status 0
[[ -n "$LAST_STDOUT" ]] || fail "expected non-empty --agent-help output"

step "guide --json"
run guide --json
expect_status 0
assert_ok_true

# --- document lifecycle ------------------------------------------------------

step "new"
run new "Smoke New Doc" --tags smoke,new
expect_status 0

step "add (file)"
ADD_FILE="$TMP/add-file.md"
cat >"$ADD_FILE" <<'DOC'
# Smoke File Doc

This document links to [[Smoke Stdin Doc]] and mentions smoke testing.
DOC
run add "$ADD_FILE" --title "Smoke File Doc" --tags smoke,file
expect_status 0

step "add (stdin)"
STDIN_DOC=$'# Smoke Stdin Doc\n\nBase document for backlink and resolve testing. Mentions smoke report.\n'
run_stdin "$STDIN_DOC" add --title "Smoke Stdin Doc" --tags smoke,stdin
expect_status 0

step "list"
run list
expect_status 0
assert_contains "$LAST_STDOUT" "Smoke File Doc" "list output"

step "list --json"
run list --json
expect_status 0
assert_ok_true

step "search"
run search smoke
expect_status 0

step "search --jsonl"
run search smoke --jsonl
expect_status 0

step "tags"
run tags
expect_status 0
assert_contains "$LAST_STDOUT" "smoke" "tags output"

step "get"
run get "Smoke File Doc"
expect_status 0

step "get --meta-only"
run get "Smoke File Doc" --meta-only
expect_status 0

step "path"
run path "Smoke File Doc"
expect_status 0
[[ -n "$LAST_STDOUT" ]] || fail "expected a path for Smoke File Doc"

step "resolve (unambiguous)"
run resolve "Smoke New Doc" --json
expect_status 0
assert_ok_true
assert_contains "$LAST_STDOUT" "smoke-new-doc" "resolve candidates"

step "resolve (ambiguous phrase is data, never an error)"
# "Smoke" is contained in all three slugs. resolve is the disambiguation
# call, so it ranks them rather than refusing.
run resolve "Smoke" --json
expect_status 0
assert_ok_true
assert_contains "$LAST_STDOUT" "smoke-file-doc" "resolve candidates"
assert_contains "$LAST_STDOUT" "smoke-stdin-doc" "resolve candidates"

step "ambiguous ref on a ref-taking command"
run get "Smoke" --json
expect_status 1
assert_ok_false
assert_error_code "ambiguous_ref"

step "links"
run links "Smoke File Doc"
expect_status 0
assert_contains "$LAST_STDOUT" "Smoke Stdin Doc" "links output"

step "backlinks"
run backlinks "Smoke Stdin Doc"
expect_status 0
assert_contains "$LAST_STDOUT" "Smoke File Doc" "backlinks output"

step "graph --json"
run graph --json
expect_status 0
assert_ok_true

step "doctor"
run doctor
expect_status 0

step "reindex"
run reindex
expect_status 0

# --- artifacts ----------------------------------------------------------------

step "publish (single file)"
ARTIFACT_HTML="$TMP/artifact-page.html"
cat >"$ARTIFACT_HTML" <<'HTML'
<!doctype html>
<html><head><title>Smoke Page</title></head><body><p>Smoke artifact page.</p></body></html>
HTML
run publish "$ARTIFACT_HTML" --name smoke-page --kind page --title "Smoke Page" --tag smoke,page
expect_status 0

step "publish (directory bundle)"
ARTIFACT_BUNDLE="$TMP/artifact-bundle"
mkdir -p "$ARTIFACT_BUNDLE/assets"
cat >"$ARTIFACT_BUNDLE/index.html" <<'HTML'
<!doctype html>
<html><head><title>Smoke Bundle</title></head><body><p>Smoke artifact bundle.</p></body></html>
HTML
printf 'body{color:#111}\n' >"$ARTIFACT_BUNDLE/assets/style.css"
run publish "$ARTIFACT_BUNDLE" --name smoke-bundle --kind bundle --title "Smoke Bundle" --tag smoke,bundle
expect_status 0

step "artifacts list"
run artifacts list
expect_status 0
assert_contains "$LAST_STDOUT" "smoke-page" "artifacts list output"

step "artifacts versions"
run artifacts versions smoke-page
expect_status 0

step "artifacts show"
run artifacts show smoke-page
expect_status 0

# --- tombstone / restore --------------------------------------------------

step "rm --reason"
run rm "Smoke New Doc" --reason "smoke test cleanup"
expect_status 0

step "list (confirm removed doc is gone)"
run list
expect_status 0
assert_not_contains "$LAST_STDOUT" "Smoke New Doc" "list output after rm"

step "restore"
run restore "Smoke New Doc"
expect_status 0

step "artifacts rm (tombstone, bytes survive)"
run artifacts rm smoke-bundle --reason "smoke test cleanup" --json
expect_status 0
assert_ok_true
run artifacts list --json
assert_not_contains "$LAST_STDOUT" "smoke-bundle" "artifacts list after tombstone"
run list --json
assert_not_contains "$LAST_STDOUT" "smoke-bundle" "document list after stub tombstone"

step "gc (the only command that frees bytes)"
run gc --json
expect_status 0
assert_ok_true
assert_contains "$LAST_STDOUT" "smoke-bundle" "gc report"

step "artifacts restore refuses once gc has taken the bytes"
run artifacts restore smoke-bundle --json
expect_status 1
assert_ok_false
assert_error_code "content_reclaimed"

# --- serve -------------------------------------------------------------------

step "serve"
PORT="$(bun -e '
  const net = require("net");
  const srv = net.createServer();
  srv.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(srv.address().port));
    srv.close();
  });
')"
[[ -n "$PORT" ]] || fail "could not find a free port"
echo "using port $PORT"

wiki serve --port "$PORT" >"$TMP/serve.log" 2>&1 &
SERVE_PID=$!

ready=0
for _ in $(seq 1 25); do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVE_PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if (( ! ready )); then
  cat "$TMP/serve.log" >&2 || true
  fail "serve did not become ready on port $PORT"
fi

assert_curl_ok "http://127.0.0.1:$PORT/" "index"

# Slug for the document route: prefer `get --json`'s .data.slug; fall back to
# deriving it from `path`'s filename when jq is unavailable.
DOC_SLUG=""
if have_jq; then
  run get "Smoke File Doc" --json
  DOC_SLUG="$(printf '%s' "$LAST_STDOUT" | jq -r '.data.slug // empty' 2>/dev/null || true)"
fi
if [[ -z "$DOC_SLUG" ]]; then
  run path "Smoke File Doc"
  DOC_SLUG="$(basename "$LAST_STDOUT" | sed -E 's/\.[^.]+$//')"
fi
if [[ -n "$DOC_SLUG" ]]; then
  assert_curl_ok "http://127.0.0.1:$PORT/d/$DOC_SLUG" "document route"
else
  echo "note: could not determine a document slug; skipping /d/<slug> check" >&2
fi

assert_curl_ok "http://127.0.0.1:$PORT/a/smoke-page/" "artifact latest route"

# Immutable versioned artifact URL: needs the published content hash, which
# `artifacts versions --json`'s schema isn't documented here, so this is a
# best-effort extraction and gracefully skips if it can't find one.
ARTIFACT_HASH=""
run artifacts versions smoke-page --json
if have_jq; then
  ARTIFACT_HASH="$(printf '%s' "$LAST_STDOUT" \
    | jq -r '[.. | objects | (.hash // .version // empty)] | first // empty' 2>/dev/null || true)"
else
  ARTIFACT_HASH="$(printf '%s' "$LAST_STDOUT" \
    | grep -oE '"(hash|version)"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -n1 | sed -E 's/.*:"([^"]+)"/\1/')"
fi
if [[ -n "$ARTIFACT_HASH" ]]; then
  assert_curl_ok "http://127.0.0.1:$PORT/a/smoke-page/v/$ARTIFACT_HASH/" "immutable artifact version route"
else
  echo "note: could not determine an artifact version hash; skipping /a/<name>/v/<hash>/ check" >&2
fi

kill "$SERVE_PID" 2>/dev/null || true
wait "$SERVE_PID" 2>/dev/null || true
SERVE_PID=""

# --- house contract: usage faults vs. domain failures -------------------------

step "usage fault: missing required ref"
run get
expect_status 2
expect_stdout_empty

step "usage fault: unknown flag"
run list --this-flag-does-not-exist
expect_status 2
expect_stdout_empty

step "domain failure: unknown ref"
run get no-such-doc --json
expect_status 1
assert_ok_false

# --- index is rebuildable -------------------------------------------------

step "index rebuild after deleting index.sqlite3"
rm -f "$AGENTWIKI_VAULT/.agentwiki/index.sqlite3"
run list
expect_status 0

echo
printf '\033[32m%s\033[0m\n' "ALL SMOKE CHECKS PASSED"
