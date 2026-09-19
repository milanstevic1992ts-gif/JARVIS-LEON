#!/usr/bin/env bash
set -euo pipefail

SUDOERS_PATH="/etc/sudoers.d/ge360-jarvis-ollama"
DROPIN_PATH="/etc/systemd/system/ge360-jarvis.service.d/brain-control.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Esegui con sudo: sudo bash deploy/debian/disable-brain-service-control.sh"
  exit 1
fi

rm -f "${SUDOERS_PATH}" "${DROPIN_PATH}"
systemctl daemon-reload

if systemctl list-unit-files ge360-jarvis.service >/dev/null 2>&1; then
  systemctl restart ge360-jarvis.service
fi

echo "Brain service control revocato."
