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

# APT helpers for optional system dependency installation on Debian/Ubuntu.
APT_AVAILABLE=0
APT_CAN_ELEVATE=0
APT_UPDATED=0
if [[ "$(uname -s)" == "Linux" ]] && command -v apt-get >/dev/null 2>&1; then
    APT_AVAILABLE=1
    if [[ "$EUID" -eq 0 ]] || command -v sudo >/dev/null 2>&1; then
        APT_CAN_ELEVATE=1
    fi
fi

apt_run() {
    if [[ "$EUID" -eq 0 ]]; then
        env DEBIAN_FRONTEND=noninteractive apt-get "$@"
    else
        sudo env DEBIAN_FRONTEND=noninteractive apt-get "$@"
    fi
}

apt_update_once() {
    [[ "$APT_UPDATED" -eq 1 ]] && return 0
    [[ "$APT_AVAILABLE" -eq 1 ]] || return 1
    [[ "$APT_CAN_ELEVATE" -eq 1 ]] || return 1
    log "Refreshing APT package indexes..."
    apt_run update 2>&1 | prefix_output "$DIM" "apt:update"
    if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
        return 1
    fi
    APT_UPDATED=1
    return 0
}

pick_apt_pkg() {
    local pkg
    for pkg in "$@"; do
        if apt-cache show "$pkg" >/dev/null 2>&1; then
            echo "$pkg"
            return 0
        fi
    done
    return 1
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
if [[ "$APT_AVAILABLE" -eq 1 ]]; then
    log "Installing Chromium system runtime dependencies..."
    if [[ "$APT_CAN_ELEVATE" -eq 1 ]]; then
        apt_update_once || log "${YELLOW}WARNING:${RESET} apt update failed — dependency installs may fail"

        if [[ "$EUID" -eq 0 ]]; then
            npx puppeteer browsers install chrome --install-deps 2>&1 | prefix_output "$DIM" "chrome-deps"
        else
            sudo env PATH="$PATH" npx puppeteer browsers install chrome --install-deps 2>&1 | prefix_output "$DIM" "chrome-deps"
        fi

        if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
            log "${YELLOW}WARNING:${RESET} Chrome deps auto-install failed — trying APT fallback set"

            ASOUND_PKG="$(pick_apt_pkg libasound2t64 libasound2 || true)"
            CUPS_PKG="$(pick_apt_pkg libcups2t64 libcups2 || true)"

            CHROME_RUNTIME_PKGS=(
                fonts-liberation
                libatk-bridge2.0-0
                libatk1.0-0
                libatspi2.0-0
                libcairo2
                libgbm1
                libgtk-3-0
                libnspr4
                libnss3
                libpango-1.0-0
                libvulkan1
                libxcomposite1
                libxdamage1
                libxfixes3
                libxkbcommon0
                libxrandr2
                xdg-utils
                fontconfig
            )

            if [[ -n "$ASOUND_PKG" ]]; then CHROME_RUNTIME_PKGS+=("$ASOUND_PKG"); fi
            if [[ -n "$CUPS_PKG" ]]; then CHROME_RUNTIME_PKGS+=("$CUPS_PKG"); fi

            apt_run install -y "${CHROME_RUNTIME_PKGS[@]}" 2>&1 | prefix_output "$DIM" "chrome-apt"
            [[ ${PIPESTATUS[0]} -eq 0 ]] || log "${YELLOW}WARNING:${RESET} APT fallback dependency install failed — renderer may not start"
        fi
    else
        log "${YELLOW}WARNING:${RESET} No root/sudo access — Chrome system deps not installed"
    fi
fi

# ── Install system fonts for Chrome ───────────────────────────────────────────
EMOJI_FONT="$DIR/starembedder_web/static/fonts/NotoColorEmoji.ttf"
FONT_DIR="$HOME/.local/share/fonts"
mkdir -p "$FONT_DIR"

if [[ "$APT_AVAILABLE" -eq 1 ]] && [[ "$APT_CAN_ELEVATE" -eq 1 ]] && ! command -v fc-list >/dev/null 2>&1; then
    apt_update_once || true
    log "Installing fontconfig (provides fc-list/fc-cache)..."
    apt_run install -y fontconfig 2>&1 | prefix_output "$DIM" "fontconfig" || \
        log "${YELLOW}WARNING:${RESET} fontconfig install failed"
fi

# Noto Color Emoji (user-level, already vendored)
if [[ -f "$EMOJI_FONT" ]] && { ! command -v fc-list >/dev/null 2>&1 || ! fc-list | grep -q "Noto Color Emoji"; }; then
    log "Installing Noto Color Emoji font..."
    cp "$EMOJI_FONT" "$FONT_DIR/"
    fc-cache -f 2>/dev/null
fi

# Unifont — covers every BMP Unicode character; used as CSS last-resort fallback
if [[ "$APT_AVAILABLE" -eq 1 ]] && [[ "$APT_CAN_ELEVATE" -eq 1 ]] && { ! command -v fc-list >/dev/null 2>&1 || ! fc-list | grep -qi "unifont"; }; then
    log "Installing Unifont (broad Unicode coverage)..."
    apt_update_once || true
    if apt-cache show fonts-unifont >/dev/null 2>&1; then
        apt_run install -y fonts-unifont 2>&1 | prefix_output "$DIM" "unifont" \
            || log "${YELLOW}WARNING:${RESET} fonts-unifont install failed"
    else
        log "${YELLOW}WARNING:${RESET} fonts-unifont not available in configured APT repositories"
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
SHUTDOWN_IN_PROGRESS=0
shutdown() {
    # Ignore repeated signals while shutdown is already in progress.
    [[ "$SHUTDOWN_IN_PROGRESS" -eq 1 ]] && return
    SHUTDOWN_IN_PROGRESS=1
    trap - SIGTERM SIGINT

    log "Shutting down..."
    kill "$WEB_PID" "$BOT_PID" 2>/dev/null || true
    wait "$WEB_PID" "$BOT_PID" 2>/dev/null || true
    log "Stopped."
}
trap shutdown SIGTERM SIGINT

wait $WEB_PID $BOT_PID
