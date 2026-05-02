#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Resume Studio — One-click Ollama setup
#  Works on macOS and Linux
# ─────────────────────────────────────────────

set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║       Resume Studio — Setup          ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Install Ollama if not present ──────────
if command -v ollama &>/dev/null; then
  echo -e "${GREEN}✔ Ollama already installed${RESET}"
else
  echo -e "${YELLOW}→ Installing Ollama...${RESET}"
  OS="$(uname -s)"
  if [ "$OS" = "Darwin" ]; then
    # macOS — download the official app
    TMP=$(mktemp -d)
    curl -fsSL "https://ollama.com/download/Ollama-darwin.zip" -o "$TMP/ollama.zip"
    unzip -q "$TMP/ollama.zip" -d "$TMP"
    if [ -d "$TMP/Ollama.app" ]; then
      cp -r "$TMP/Ollama.app" /Applications/Ollama.app
      open /Applications/Ollama.app
      echo -e "${YELLOW}  Waiting for Ollama to start...${RESET}"
      sleep 6
    fi
    rm -rf "$TMP"
  else
    # Linux — official install script
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  echo -e "${GREEN}✔ Ollama installed${RESET}"
fi

# ── 2. Start Ollama server if not running ─────
if curl -s http://localhost:11434 &>/dev/null; then
  echo -e "${GREEN}✔ Ollama server already running${RESET}"
else
  echo -e "${YELLOW}→ Starting Ollama server...${RESET}"
  ollama serve &>/dev/null &
  sleep 3
  echo -e "${GREEN}✔ Ollama server started${RESET}"
fi

# ── 3. Pull model ─────────────────────────────
MODEL="llama3.2"
echo ""
echo -e "${YELLOW}→ Pulling ${BOLD}${MODEL}${RESET}${YELLOW} (this downloads ~2 GB, once only)...${RESET}"
ollama pull "$MODEL"
echo -e "${GREEN}✔ Model ready${RESET}"

# ── 4. Open the app ───────────────────────────
echo ""
echo -e "${BOLD}${GREEN}✔ All done! Opening Resume Studio...${RESET}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_FILE="$SCRIPT_DIR/index.html"

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  open "$HTML_FILE"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$HTML_FILE"
else
  echo -e "${CYAN}Open this file in your browser:${RESET}"
  echo "  $HTML_FILE"
fi

echo -e "${CYAN}Ollama is running at http://localhost:11434${RESET}"
echo ""