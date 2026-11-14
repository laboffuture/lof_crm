#!/usr/bin/env bash
# Sets up and updates the UAT copy of LOF CRM (uat.crm.laboffuture.com) next to the live one. No root and no server
# terminal needed: GitHub Actions runs it as the app user (lofcrm) on every push to the uat branch
# (.github/workflows/deploy-vps.yml). Everything lives in that user's home folder; the live CRM (/opt/lof-crm,
# port 8787, pm2 process lof-crm) is not touched. Safe to run again: data, logins and secrets are kept.
#
#   [ADMIN_PASSWORD=…] bash uat-setup.sh <commit-sha>
#
# Env: ADMIN_EMAIL (default ranjith@laboffuture.com) and ADMIN_PASSWORD – the administrator is created once, on the
#      first run that has a password; DOMAIN (default uat.crm.laboffuture.com), LOF_PORT (default 8788)
set -euo pipefail
{ # parsed in full before it runs

REF="${1:-}"
DOMAIN="${DOMAIN:-uat.crm.laboffuture.com}"
LIVE_DIR=/opt/lof-crm
APP_DIR="$HOME/lof-crm-uat"
DATA_DIR="$HOME/lof-crm-uat-data"
STATE_DIR="$DATA_DIR/state"
ENV_FILE="$DATA_DIR/env"
PORT="${LOF_PORT:-8788}"
NAME=lof-crm-uat
ADMIN_EMAIL="${ADMIN_EMAIL:-ranjith@laboffuture.com}"
export LOF_APP_DIR="$APP_DIR" LOF_STATE_DIR="$STATE_DIR" LOF_ENV_FILE="$ENV_FILE" LOF_PORT="$PORT" LOF_NAME="$NAME" LOF_BRANCH=uat
step() { echo; echo "▶ $*"; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }
db() { (cd "$APP_DIR" && npx wrangler d1 execute lof_crm --local --persist-to "$STATE_DIR" "$@"); }

if [ ! -d "$APP_DIR/.git" ]; then
  step "UAT: first setup"
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "  Port $PORT is already used by another program – set LOF_PORT in the workflow to a free port"; exit 1
  fi
  REPO_URL=$(git -C "$LIVE_DIR" remote get-url origin)
  git clone --quiet --branch uat "$REPO_URL" "$APP_DIR"
  echo "  cloned $REPO_URL (uat) into $APP_DIR"
fi

install -d -m 700 "$DATA_DIR" "$STATE_DIR"
if [ ! -f "$ENV_FILE" ]; then
  step "UAT: settings and secrets ($ENV_FILE)"
  # Own secrets, so UAT sign-ins and two-step codes never work on the live CRM (and the other way round).
  # APP_ENV stays production: other values show password-reset codes on screen, which must not happen on a public site.
  umask 077
  cat > "$ENV_FILE" <<EOF
# LOF CRM – UAT copy ($DOMAIN). Read by wrangler (--env-file). Overrides [vars] in wrangler.toml.
APP_ENV=production
APP_BASE_URL=https://$DOMAIN
INTEGRATION_MODE=auto
ALLOW_IMPERSONATION=false
MFA_REQUIRED_ROLES=""
SESSION_IDLE_MINUTES=60
# Never change JWT_SECRET once in use – it signs everyone out and breaks two-step codes
JWT_SECRET=$(rand 64)
WEBSITE_FORM_SECRET=$(rand)
META_VERIFY_TOKEN=$(rand 24)
WHATSAPP_VERIFY_TOKEN=$(rand 24)
EXOTEL_WEBHOOK_TOKEN=$(rand 32)
EOF
  echo "  created with fresh random secrets"
fi

# Code, dependencies, database migrations, (re)start and health check – the same steps as the live CRM
bash "$APP_DIR/deploy/vps/remote-deploy.sh" ${REF:+"$REF"}

step "UAT: administrator $ADMIN_EMAIL"
email=$(printf '%s' "$ADMIN_EMAIL" | tr 'A-Z' 'a-z' | sed "s/'/''/g")
found=$(db --json --command "SELECT COUNT(*) AS n FROM staff_auth WHERE email='$email'" 2>/dev/null | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' || echo 0)
if [ "${found:-0}" != 0 ]; then
  echo "  exists"
elif [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "  not created yet – add the repository secret UAT_ADMIN_PASSWORD and run the workflow again"
else
  tmp=$(mktemp)
  (cd "$APP_DIR" && ADMIN_PASSWORD="$ADMIN_PASSWORD" node scripts/create-admin.mjs --email "$ADMIN_EMAIL" --name "${ADMIN_NAME:-Ranjith}") > "$tmp"
  pm2 stop "$NAME" >/dev/null
  db --file "$tmp" >/dev/null
  rm -f "$tmp"
  pm2 start "$NAME" >/dev/null
  echo "  created"
fi

# One-time administrator password reset: deploy/vps/uat-admin-reset.sql (made with scripts/create-admin.mjs
# --must-change, so it holds only a password hash) is applied once per file content, then never again.
RESET="$APP_DIR/deploy/vps/uat-admin-reset.sql"
if [ -f "$RESET" ]; then
  mark="$DATA_DIR/admin-reset-$(sha256sum "$RESET" | cut -c1-16)"
  if [ ! -f "$mark" ]; then
    step "UAT: one-time administrator password reset"
    pm2 stop "$NAME" >/dev/null
    db --file "$RESET" >/dev/null
    pm2 start "$NAME" >/dev/null
    touch "$mark"
    echo "  applied – a new password must be chosen at the next sign-in"
  fi
fi

step "UAT: background jobs (every 5 minutes)"
CRON_LINE="*/5 * * * * curl -fsS -o /dev/null 'http://127.0.0.1:$PORT/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*'"
( crontab -l 2>/dev/null | grep -vF "127.0.0.1:$PORT/cdn-cgi/handler/scheduled" || true; echo "$CRON_LINE" ) | crontab -
echo "  installed (the live CRM's job is kept)"

for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null && break; sleep 2; done

# Server health, shown as notes on the GitHub run (disk space, temp folders, a sign-in request straight to the app)
note() { echo "::notice title=UAT server::$*"; }
df -hP / /tmp /home 2>/dev/null | awk 'NR>1 && !s[$6]++ {print "disk " $6 ": " $5 " used, " $4 " free"}' | while read -r l; do note "$l"; done
df -iP / /tmp 2>/dev/null | awk 'NR>1 && !s[$6]++ {print "inodes " $6 ": " $5 " used"}' | while read -r l; do note "$l"; done
for d in /tmp /tmp/lshttpd /tmp/lshttpd/swap; do [ -e "$d" ] && note "$d: $(stat -c '%A %U' "$d" 2>/dev/null)"; done
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{"email":"nobody@example.com","password":"x-check-only-1"}' "http://127.0.0.1:$PORT/api/v1/auth/login" || echo none)
note "sign-in straight to the app (expect 401): $code"
echo
echo "✔ UAT is running on 127.0.0.1:$PORT – CyberPanel proxies https://$DOMAIN to it (DEPLOY-VPS.md, 'UAT copy')"
exit 0
}
