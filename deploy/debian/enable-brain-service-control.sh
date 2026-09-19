#!/usr/bin/env bash
set -euo pipefail

SUDOERS_PATH="/etc/sudoers.d/ge360-jarvis-ollama"
DROPIN_DIR="/etc/systemd/system/ge360-jarvis.service.d"
DROPIN_PATH="${DROPIN_DIR}/brain-control.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Esegui con sudo: sudo bash deploy/debian/enable-brain-service-control.sh"
  exit 1
fi

RUN_USER="${SUDO_USER:-}"
if [[ -z "${RUN_USER}" || "${RUN_USER}" == "root" ]]; then
  echo "Impossibile determinare l'utente JARVIS. Avvia lo script con sudo dal tuo utente normale."
  exit 1
fi

if [[ ! "${RUN_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  echo "Nome utente non valido: ${RUN_USER}"
  exit 1
fi

SYSTEMCTL_BIN="$(command -v systemctl || true)"
VISUDO_BIN="$(command -v visudo || true)"

if [[ -z "${SYSTEMCTL_BIN}" || -z "${VISUDO_BIN}" ]]; then
  echo "systemctl/visudo non trovati."
  exit 1
fi

if ! systemctl list-unit-files ge360-jarvis.service >/dev/null 2>&1; then
  echo "ge360-jarvis.service non installato."
  exit 1
fi

TMP_SUDOERS="$(mktemp)"
trap 'rm -f "${TMP_SUDOERS}"' EXIT

printf '%s ALL=(root) NOPASSWD: %s restart ollama.service\n'   "${RUN_USER}" "${SYSTEMCTL_BIN}" > "${TMP_SUDOERS}"

"${VISUDO_BIN}" -cf "${TMP_SUDOERS}" >/dev/null
install -m 0440 "${TMP_SUDOERS}" "${SUDOERS_PATH}"

install -d -m 0755 "${DROPIN_DIR}"
cat > "${DROPIN_PATH}" <<'EOF'
[Service]
Environment=JARVIS_ALLOW_SYSTEM_SERVICE_CONTROL=1
EOF

systemctl daemon-reload
systemctl restart ge360-jarvis.service

echo
echo "Brain service control abilitato."
echo "Jarvis può eseguire SOLO:"
echo "  ${SYSTEMCTL_BIN} restart ollama.service"
echo
echo "Per revocare:"
echo "  sudo bash deploy/debian/disable-brain-service-control.sh"
