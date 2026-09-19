#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="ge360-jarvis"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE="${SCRIPT_DIR}/ge360-jarvis.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Esegui questo script con sudo: sudo bash deploy/debian/install-service.sh"
  exit 1
fi

RUN_USER="${SUDO_USER:-}"
if [[ -z "${RUN_USER}" || "${RUN_USER}" == "root" ]]; then
  echo "Impossibile determinare l'utente JARVIS. Esegui con sudo dal tuo utente normale."
  exit 1
fi

RUN_HOME="$(getent passwd "${RUN_USER}" | cut -d: -f6)"
if [[ -z "${RUN_HOME}" || ! -d "${RUN_HOME}" ]]; then
  echo "Home utente non valida per ${RUN_USER}."
  exit 1
fi

PNPM_BIN="$(sudo -u "${RUN_USER}" -H bash -lc 'command -v pnpm || true')"
NODE_BIN="$(sudo -u "${RUN_USER}" -H bash -lc 'command -v node || true')"
if [[ -z "${PNPM_BIN}" || -z "${NODE_BIN}" ]]; then
  echo "node/pnpm non trovati per ${RUN_USER}. Installa le dipendenze del progetto prima del servizio."
  exit 1
fi

NODE_DIR="$(dirname "${NODE_BIN}")"
PNPM_DIR="$(dirname "${PNPM_BIN}")"
JARVIS_PATH="${NODE_DIR}:${PNPM_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ ! -f "${REPO_DIR}/package.json" ]]; then
  echo "Repository JARVIS non valida: ${REPO_DIR}"
  exit 1
fi

if [[ ! -d "${REPO_DIR}/node_modules" ]]; then
  echo "node_modules non esiste. Esegui prima: pnpm install"
  exit 1
fi

if [[ ! -f "${REPO_DIR}/server/dist/index.js" ]]; then
  echo "Build production non trovato. Avvio pnpm run build come ${RUN_USER}..."
  sudo -u "${RUN_USER}" -H bash -lc "cd '${REPO_DIR}' && pnpm run build"
fi

sed \
  -e "s|__JARVIS_USER__|${RUN_USER}|g" \
  -e "s|__JARVIS_HOME__|${RUN_HOME}|g" \
  -e "s|__JARVIS_PATH__|${JARVIS_PATH}|g" \
  -e "s|__JARVIS_DIR__|${REPO_DIR}|g" \
  -e "s|__PNPM_BIN__|${PNPM_BIN}|g" \
  "${TEMPLATE}" > "${UNIT_PATH}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

echo
echo "Servizio installato: ${UNIT_PATH}"
echo "Avvio:   sudo systemctl start ${SERVICE_NAME}"
echo "Stato:   systemctl status ${SERVICE_NAME}"
echo "Log:     journalctl -u ${SERVICE_NAME} -f"
echo
