#!/bin/bash

# ── Helpers ──────────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
CYAN="\033[36m"
YELLOW="\033[33m"
GREEN="\033[32m"
RED="\033[31m"
DIM="\033[2m"

log()  { echo -e "${DIM}[$(date '+%H:%M:%S')]${RESET} ${BOLD}[start]${RESET} $*"; }
fail() { echo -e "${DIM}[$(date '+%H:%M:%S')]${RESET} ${RED}${BOLD}[start] ERROR:${RESET} $*" >&2; exit 1; }

# ── Load nvm so npm/npx/node are on PATH ─────────────────────────────────────
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
nvm alias default node >/dev/null 2>&1 || true

# Prefix every line of a service's output with a coloured tag
prefix_output() {
    local color=$1 name=$2
    while IFS= read -r line; do
        echo -e "${DIM}[$(date '+%H:%M:%S')]${RESET} ${color}${BOLD}[$name]${RESET} $line"
    done
}



# ── Paths & package manager ───────────────────────────────────────────────────
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(command -v pnpm 2>/dev/null || command -v npm 2>/dev/null || echo /usr/local/bin/npm)"
log "Working directory : $DIR"
log "Package manager   : $PKG"

# ── Auto-update ───────────────────────────────────────────────────────────────
if [[ -d "$DIR/.git" ]] && [[ "${AUTO_UPDATE}" == "1" ]]; then
    log "Pulling latest changes..."
    git -C "$DIR" pull || fail "git pull failed"
fi

# ── Pelican: inject/remove extra packages ─────────────────────────────────────
if [[ -n "${NODE_PACKAGES}" ]];   then $PKG add    ${NODE_PACKAGES};    fi
if [[ -n "${UNNODE_PACKAGES}" ]]; then $PKG remove ${UNNODE_PACKAGES};  fi

# ── Install dependencies ──────────────────────────────────────────────────────
log "Installing bot dependencies..."
cd "$DIR/starembedder_bot"
$PKG install || fail "bot install failed"

log "Installing web dependencies..."
cd "$DIR/starembedder_web"
$PKG install || fail "web install failed"

# ── Install Puppeteer browsers + system runtime dependencies ──────────────────
log "Installing Puppeteer browsers..."
cd "$DIR/starembedder_web"
npx puppeteer browsers install chrome || fail "puppeteer browsers install failed"

# Let Puppeteer install Chrome's Linux system dependencies using its own
# distro-aware resolver (handles Ubuntu 24.04 t64 package names correctly).
if [[ "$(uname -s)" == "Linux" ]] && command -v apt-get >/dev/null 2>&1; then
    log "Installing Chromium system runtime dependencies..."
    if [[ "$EUID" -eq 0 ]]; then
        npx puppeteer browsers install chrome --install-deps 2>&1 | prefix_output "$DIM" "chrome-deps" || \
            log "${YELLOW}WARNING:${RESET} Chrome system deps install failed — renderer may not start"
    elif command -v sudo >/dev/null 2>&1; then
        sudo env PATH="$PATH" npx puppeteer browsers install chrome --install-deps 2>&1 | prefix_output "$DIM" "chrome-deps" || \
            log "${YELLOW}WARNING:${RESET} Chrome system deps install failed — renderer may not start"
    else
        log "${YELLOW}WARNING:${RESET} No root/sudo access — Chrome system deps not installed"
    fi
fi

# ── Install system fonts for Chrome ───────────────────────────────────────────
EMOJI_FONT="$DIR/starembedder_web/static/fonts/NotoColorEmoji.ttf"
FONT_DIR="$HOME/.local/share/fonts"
mkdir -p "$FONT_DIR"

# Noto Color Emoji (user-level, already vendored)
if [[ -f "$EMOJI_FONT" ]] && ! fc-list | grep -q "Noto Color Emoji"; then
    log "Installing Noto Color Emoji font..."
    cp "$EMOJI_FONT" "$FONT_DIR/"
    fc-cache -f 2>/dev/null
fi

# Unifont — covers every BMP Unicode character; used as CSS last-resort fallback
if command -v apt-get >/dev/null 2>&1 && ! fc-list | grep -qi "unifont"; then
    log "Installing Unifont (broad Unicode coverage)..."
    if [[ "$EUID" -eq 0 ]]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y fonts-unifont 2>&1 | prefix_output "$DIM" "unifont" \
            || log "${YELLOW}WARNING:${RESET} fonts-unifont install failed"
    elif command -v sudo >/dev/null 2>&1; then
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y fonts-unifont 2>&1 | prefix_output "$DIM" "unifont" \
            || log "${YELLOW}WARNING:${RESET} fonts-unifont install failed"
    fi
fi

# ── Database migrations ───────────────────────────────────────────────────────
if [[ "${SKIP_MIGRATE}" != "1" ]]; then
    log "Running database migrations..."
    cd "$DIR/starembedder_bot"
    $PKG run db:migrate 2>&1 | prefix_output "$DIM" "db:migrate" \
        || log "${YELLOW}WARNING:${RESET} db:migrate failed (DB env vars may not be set) — skipping"
else
    log "Skipping database migrations (SKIP_MIGRATE=1)"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
log "Building bot..."
cd "$DIR/starembedder_bot"
$PKG run build 2>&1 | prefix_output "$YELLOW" "bot:build"
[[ ${PIPESTATUS[0]} -eq 0 ]] || fail "bot build failed"

log "Building web..."
cd "$DIR/starembedder_web"
$PKG run build 2>&1 | prefix_output "$CYAN" "web:build"
[[ ${PIPESTATUS[0]} -eq 0 ]] || fail "web build failed"

# ── Start services ────────────────────────────────────────────────────────────
log "${GREEN}Starting both services...${RESET}"

# Load a .env file into the current shell environment (skips comments/blanks)
load_env() {
    local envfile=$1
    if [[ -f "$envfile" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// }" ]] && continue
            export "${line?}"
        done < "$envfile"
    fi
}

# Web: load .env so PORT/HOST/ORIGIN are available to adapter-node
( load_env "$DIR/starembedder_web/.env"; cd "$DIR/starembedder_web" && node build ) 2>&1 | prefix_output "$CYAN"   "web" &
WEB_PID=$!

( cd "$DIR/starembedder_bot" && node dist/index.js ) 2>&1 | prefix_output "$YELLOW" "bot" &
BOT_PID=$!

log "Web PID: $WEB_PID  |  Bot PID: $BOT_PID"

# Forward shutdown signals to both children
trap '
    log "Shutting down..."
    kill $WEB_PID $BOT_PID 2>/dev/null
    wait $WEB_PID $BOT_PID 2>/dev/null
    log "Stopped."
' SIGTERM SIGINT

wait $WEB_PID $BOT_PID
