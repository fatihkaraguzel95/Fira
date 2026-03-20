#!/bin/bash
# -----------------------------------------------
# Fira — CI/CD Installer
# Run once on the server: bash cicd/install.sh
# -----------------------------------------------

set -e

FIRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CICD_DIR="$FIRA_DIR/cicd"
SERVICE_NAME="fira-webhook"
HOOKS_FILE="$CICD_DIR/hooks.json"
DEPLOY_SCRIPT="$CICD_DIR/deploy.sh"
WEB_DIR="/var/www/fira"
USER=$(whoami)

echo ""
echo "======================================"
echo "  Fira CI/CD Installer"
echo "======================================"
echo ""

# 1. Install webhook binary
if ! command -v webhook &> /dev/null; then
  echo "[1/6] Installing webhook..."
  sudo apt update -qq
  sudo apt install -y webhook
else
  echo "[1/6] webhook already installed — skipping."
fi

# 2. Generate a random secret token
SECRET=$(openssl rand -hex 32)
echo ""
echo "[2/6] Generated webhook secret:"
echo "      $SECRET"
echo "      (Save this — you will paste it into GitHub)"
echo ""

# 3. Inject secret into hooks.json
sed -i "s/REPLACE_WITH_YOUR_SECRET/$SECRET/" "$HOOKS_FILE"
echo "[3/6] Secret injected into hooks.json."

# 4. Make deploy script executable
chmod +x "$DEPLOY_SCRIPT"
echo "[4/6] deploy.sh marked executable."

# 5. Allow deploy.sh to copy files without password prompt
SUDOERS_LINE="$USER ALL=(ALL) NOPASSWD: /bin/cp, /bin/mkdir"
if ! sudo grep -qF "$SUDOERS_LINE" /etc/sudoers; then
  echo "$SUDOERS_LINE" | sudo tee -a /etc/sudoers > /dev/null
  echo "[5/6] Sudoers rule added for cp and mkdir."
else
  echo "[5/6] Sudoers rule already present — skipping."
fi

# 6. Install and start systemd service
sudo cp "$CICD_DIR/webhook.service" /etc/systemd/system/fira-webhook.service

# Replace placeholder user in service file with actual user
sudo sed -i "s/User=sakgun/User=$USER/" /etc/systemd/system/fira-webhook.service

sudo systemctl daemon-reload
sudo systemctl enable fira-webhook
sudo systemctl restart fira-webhook
echo "[6/6] fira-webhook service installed and started."

# 7. Create web root
sudo mkdir -p "$WEB_DIR"

# Done
echo ""
echo "======================================"
echo "  Installation complete!"
echo "======================================"
echo ""
echo "  Webhook URL:  http://$(hostname -I | awk '{print $1}'):9000/hooks/deploy-fira"
echo "  Secret:       $SECRET"
echo ""
echo "  Paste both into GitHub:"
echo "  Repo → Settings → Webhooks → Add webhook"
echo "    Content type: application/json"
echo "    Events:       Just the push event"
echo ""
echo "  Monitor deploys:"
echo "    sudo journalctl -u fira-webhook -f   (webhook logs)"
echo "    tail -f /var/log/fira-deploy.log     (deploy logs)"
echo ""
