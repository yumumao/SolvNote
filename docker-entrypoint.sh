#!/bin/sh
set -e

cd /app
TARGET_DB="/app/data/dev.db"
SEED_MARKER="/app/data/.seed_completed"
VERSION_FILE="/app/data/.app_version"
PRISMA_BIN="/app/node_modules/prisma/build/index.js"
SEED_ADMIN_SCRIPT="/app/dist-scripts/scripts/seed-admin.js"
REBUILD_TAGS_SCRIPT="/app/dist-scripts/scripts/rebuild-system-tags.js"

CURRENT_VERSION=$(node -p "require('./package.json').version")

# Keep both persistent volumes, including the AI master key in /app/config.
# A fresh image contains no pre-seeded database or private configuration.
mkdir -p /app/data /app/config
chown -R nextjs:nodejs /app/data /app/config

FRESH_DATABASE=false
if [ ! -s "$TARGET_DB" ]; then
    FRESH_DATABASE=true
    echo "[Entrypoint] Initializing database from migrations..."
fi

PREVIOUS_VERSION=""
if [ -f "$VERSION_FILE" ]; then
    PREVIOUS_VERSION=$(cat "$VERSION_FILE")
fi

# Fail closed: a migration failure is NOT the same as no pending migrations.
# Run initialization as the application user so new SQLite files stay writable.
echo "[Entrypoint] Running database migrations to sync schema..."
if ! su-exec nextjs:nodejs node "$PRISMA_BIN" migrate deploy --schema=./prisma/schema.prisma; then
    echo "[Entrypoint] Database migration failed; refusing to start the application." >&2
    exit 1
fi
echo "[Entrypoint] Migrations completed successfully."

# This must also run on existing volumes after migrations (role/isActive repair).
echo "[Entrypoint] Ensuring admin user exists with correct role..."
if ! su-exec nextjs:nodejs node "$SEED_ADMIN_SCRIPT"; then
    echo "[Entrypoint] Admin initialization failed; refusing to start the application." >&2
    exit 1
fi

# Fresh volumes need tags even if an old version marker survived a DB restore.
# Record successful initialization only after ALL required steps succeeded.
if [ "$FRESH_DATABASE" = true ] || [ "$PREVIOUS_VERSION" != "$CURRENT_VERSION" ]; then
    echo "[Entrypoint] Initializing/updating system tags for version $CURRENT_VERSION..."
    if ! su-exec nextjs:nodejs node "$REBUILD_TAGS_SCRIPT"; then
        echo "[Entrypoint] Tag initialization failed; leaving version marker unchanged for retry." >&2
        exit 1
    fi
fi
touch "$SEED_MARKER"
printf '%s\n' "$CURRENT_VERSION" > "$VERSION_FILE"

# HTTPS Setup
CERT_DIR="/app/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if [ "$HTTPS_ENABLED" = "true" ]; then
    echo "[Entrypoint] HTTPS enabled"
    
    # 确保证书目录存在
    mkdir -p "$CERT_DIR"
    chown nextjs:nodejs "$CERT_DIR"
    
    # 检查证书是否存在
    if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
        echo "[Entrypoint] 证书不存在，自动生成自签名证书..."
        
        # 获取证书 CN（优先使用环境变量，否则使用 localhost）
        CERT_CN="${CERT_DOMAIN:-localhost}"
        
        # 生成自签名证书（有效期 10 年）
        openssl req -x509 -newkey rsa:2048 \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -days 3650 \
            -nodes \
            -subj "/CN=$CERT_CN" \
            2>/dev/null
        
        if [ $? -eq 0 ]; then
            echo "[Entrypoint] 自签名证书生成成功: CN=$CERT_CN"
            chown nextjs:nodejs "$CERT_FILE" "$KEY_FILE"
        else
            echo "[Entrypoint] 警告: 证书生成失败，HTTPS 将不可用"
        fi
    else
        echo "[Entrypoint] 使用已有证书: $CERT_FILE"
    fi
    
    # 启动 HTTPS 代理
    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        echo "[Entrypoint] 启动 HTTPS 代理 (端口 443)..."
        su-exec nextjs:nodejs node /app/https-server.js &
    fi
fi

# Execute the main container command as nextjs user
exec su-exec nextjs:nodejs "$@"
