#!/usr/bin/env bash
# =============================================================================
# Octop 一键启动（bash / Git Bash / WSL / macOS / Linux）
#
# 做什么：
#   1. 检查 docker 与守护进程是否可用；
#   2. 创建宿主数据目录（默认 D:/octop-data，避免写系统盘）；
#   3. 构建并启动 Octop（默认 SQLite，可用 --postgres 切到 PostgreSQL）；
#   4. 轮询 /api/health 直到就绪，并幂等确保演示账号 demo 存在（登录页「一键填入」用）；
#   5. 打印访问地址与首次登录凭据。
#
# 用法：
#   bash docker/octop-up.sh                  # SQLite 模式，一键跑通（推荐先用这个）
#   bash docker/octop-up.sh --postgres       # 额外拉起 PostgreSQL(pgvector) 并切换数据库
#   bash docker/octop-up.sh --port 9090      # 换端口
#   bash docker/octop-up.sh --data /d/octop-data/.octop
#   bash docker/octop-up.sh --mirror         # 构建走腾讯云镜像源（国内网络加速）
#   bash docker/octop-up.sh --no-build       # 跳过构建，直接用已有 octop:latest
#   bash docker/octop-up.sh --foreground     # 前台运行（不 -d），便于看日志
#
# 停止 / 查看：
#   bash docker/octop-ctl.sh down | status | logs | password | restart
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/oneclick.env"
COMPOSE_ONE="${SCRIPT_DIR}/docker-compose.oneclick.yml"

USE_POSTGRES=0
USE_MIRROR=0
DO_BUILD=1
DETACH=1
PORT_OVERRIDE=""
DATA_OVERRIDE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --postgres)   USE_POSTGRES=1 ;;
        --mirror)     USE_MIRROR=1 ;;
        --no-build)   DO_BUILD=0 ;;
        --foreground) DETACH=0 ;;
        --port)       PORT_OVERRIDE="${2:-}"; shift ;;
        --data)       DATA_OVERRIDE="${2:-}"; shift ;;
        -h|--help)    sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "[错误] 未知参数: $1（用 --help 查看用法）" >&2; exit 2 ;;
    esac
    shift
done

log()  { printf '\033[36m[octop]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[octop]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[octop]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. 环境检查
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "未找到 docker，请先安装 Docker Desktop / Docker Engine。"

if ! docker info >/dev/null 2>&1; then
    die "Docker 守护进程未运行。请先启动 Docker Desktop（Windows/macOS）或 systemctl start docker（Linux）。"
fi

docker compose version >/dev/null 2>&1 \
    || die "未找到 docker compose 插件（v2）。请升级 Docker Desktop，或安装 docker-compose-plugin。"

[ -f "${ENV_FILE}" ]      || die "缺少配置文件: ${ENV_FILE}"
[ -f "${COMPOSE_ONE}" ]   || die "缺少编排文件: ${COMPOSE_ONE}"

# ---------------------------------------------------------------------------
# 2. 解析运行时参数
# ---------------------------------------------------------------------------
ENV_PORT="$(sed -n 's/^OCTOP_PORT=//p' "${ENV_FILE}" | head -1)"
ENV_DATA="$(sed -n 's/^OCTOP_DATA=//p' "${ENV_FILE}" | head -1)"
PORT="${PORT_OVERRIDE:-${ENV_PORT:-8088}}"

if [ -n "${DATA_OVERRIDE}" ]; then
    DATA_DIR="${DATA_OVERRIDE}"
elif [ -n "${ENV_DATA}" ]; then
    DATA_DIR="${ENV_DATA}"
else
    DATA_DIR="${HOME}/.octop"
fi

# Windows(Git Bash) 下把 D:/x 形式转成 /d/x 以便 mkdir
mkdir -p "${DATA_DIR}" 2>/dev/null || true
if [ ! -d "${DATA_DIR}" ]; then
    case "${DATA_DIR}" in
        [A-Za-z]:/*) MK_DIR="/$(printf '%s' "${DATA_DIR%%:*}" | tr 'A-Z' 'a-z')/${DATA_DIR#*:/}"
                     mkdir -p "${MK_DIR}" || die "无法创建数据目录: ${DATA_DIR}" ;;
        *) die "无法创建数据目录: ${DATA_DIR}" ;;
    esac
fi
log "数据目录: ${DATA_DIR}"
log "服务端口: ${PORT}"

# ---------------------------------------------------------------------------
# 3. 组装 compose 参数
# ---------------------------------------------------------------------------
COMPOSE_ARGS=(compose --env-file "${ENV_FILE}" -f "${COMPOSE_ONE}")

if [ "${USE_POSTGRES}" -eq 1 ]; then
    COMPOSE_ARGS+=(--profile postgres)
    log "数据库模式: PostgreSQL (pgvector:pg16)"
else
    log "数据库模式: SQLite（容器内 ~/.octop/octop.db）"
fi

BUILD_ARGS=()
if [ "${DO_BUILD}" -eq 1 ]; then
    BUILD_ARGS+=(--build)
    if [ "${USE_MIRROR}" -eq 1 ]; then
        log "构建加速: 腾讯云镜像源"
        export PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"
        export PIP_TRUSTED_HOST="mirrors.cloud.tencent.com"
        export NPM_REGISTRY="https://mirrors.cloud.tencent.com/npm/"
        export APT_MIRROR="mirrors.cloud.tencent.com"
        export COMPOSE_BAKE=true
    fi
fi

UP_ARGS=(up)
[ "${DETACH}" -eq 1 ] && UP_ARGS+=(-d)
UP_ARGS+=(--remove-orphans)
UP_ARGS+=("${BUILD_ARGS[@]}")

# PostgreSQL 模式下把连接信息注入应用容器（同名 shell 变量优先级高于 --env-file）
if [ "${USE_POSTGRES}" -eq 1 ]; then
    PG_USER="$(sed -n 's/^OCTOP_PG_USER=//p'      "${ENV_FILE}" | head -1)"; PG_USER="${PG_USER:-octop}"
    PG_PASS="$(sed -n 's/^OCTOP_PG_PASSWORD=//p'  "${ENV_FILE}" | head -1)"; PG_PASS="${PG_PASS:-octop}"
    PG_DB="$(sed -n 's/^OCTOP_PG_DB=//p'          "${ENV_FILE}" | head -1)"; PG_DB="${PG_DB:-octop}"
    export OCTOP_DATABASE_DRIVER=postgresql
    export OCTOP_DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}"
    export OCTOP_DATABASE_HOST=postgres
    export OCTOP_DATABASE_PORT=5432
    export OCTOP_DATABASE_NAME="${PG_DB}"
    export OCTOP_DATABASE_USER="${PG_USER}"
    export OCTOP_DATABASE_PASSWORD="${PG_PASS}"
fi

# 端口/数据目录用命令行覆盖时，通过环境变量覆盖 oneclick.env 的值
export OCTOP_PORT="${PORT}"
export OCTOP_DATA="${DATA_DIR}"

# ---------------------------------------------------------------------------
# 3.5 合规门禁：分发物必须随附 LICENSE（MIT 硬条件，D13-D16 上云阻塞项）
#     - 宿主机：仓库根 LICENSE 必须存在且非空
#     - 镜像内：由 docker/Dockerfile 的 `COPY ... LICENSE ./` 保证，构建后抽查
# ---------------------------------------------------------------------------
if [ "${DO_BUILD}" -eq 1 ]; then
    if [ ! -s "${REPO_ROOT}/LICENSE" ]; then
        die "合规门禁失败：仓库根缺少 LICENSE 文件，禁止构建对外分发的镜像。"
    fi
    if ! grep -q "MIT License\|Permission is hereby granted" "${REPO_ROOT}/LICENSE" 2>/dev/null; then
        log "警告：LICENSE 文本与预期 MIT 不符，请人工确认后再对外分发。"
    fi
    log "合规门禁: LICENSE 在位（$(wc -c < "${REPO_ROOT}/LICENSE" | tr -d ' ') 字节）"
fi

# ---------------------------------------------------------------------------
# 4. 构建 + 启动
# ---------------------------------------------------------------------------
log "开始构建并启动（首次构建需下载依赖，请耐心等待）..."
if ! ( cd "${REPO_ROOT}" && docker "${COMPOSE_ARGS[@]}" "${UP_ARGS[@]}" ); then
    die "启动失败。可执行 'bash docker/octop-ctl.sh logs' 查看日志。"
fi

[ "${DETACH}" -eq 1 ] || exit 0

# ---------------------------------------------------------------------------
# 5. 等待健康检查
# ---------------------------------------------------------------------------
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
log "等待服务就绪: ${HEALTH_URL}"
READY=0
for i in $(seq 1 60); do
    if curl -fsS --noproxy '*' --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then
        READY=1; break
    fi
    printf '.'
    sleep 5
done
printf '\n'

if [ "${READY}" -ne 1 ]; then
    warn "60 次探测后仍未就绪（首次初始化可能较慢）。"
    warn "用 'bash docker/octop-ctl.sh logs' 观察进度，稍后重试 health。"
else
    log "服务已就绪 ✅"
fi

# ---------------------------------------------------------------------------
# 5.5 演示账号（幂等）
#     登录页写死了 demo / Demo@2026 的「一键填入」，后端没有这个账号时那条提示
#     就是误导，所以这里在部署物里把账号补齐。必须等服务就绪（= 容器入口脚本的
#     octop init 已建好首个管理员）之后再补建：CLI 离线开库会顺带跑迁移，实例
#     还没有任何账号时会让它抢先建库、把首次初始化顶掉。
#     账号已存在则跳过 —— 重复执行本脚本不报错、也不会建重复账号。
#     PostgreSQL 模式下容器已注入 OCTOP_DATABASE_*，CLI 连的是同一个库。
# ---------------------------------------------------------------------------
DEMO_USERNAME="demo"
DEMO_PASSWORD="Demo@2026"
DEMO_HINT_CMD="docker exec -it octop octop user create ${DEMO_USERNAME} --password '${DEMO_PASSWORD}' --role admin"
DEMO_STATE="skipped"

if [ "${READY}" -ne 1 ]; then
    warn "服务未就绪，跳过演示账号创建。就绪后可手动执行："
    warn "  ${DEMO_HINT_CMD}"
else
    HEALTH_BODY="$(curl -fsS --noproxy '*' --max-time 5 "${HEALTH_URL}" 2>/dev/null || true)"
    USERS_LOADED="$(printf '%s' "${HEALTH_BODY}" \
        | sed -n 's/.*"users_loaded":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
    if [ -z "${USERS_LOADED}" ] || [ "${USERS_LOADED}" -lt 1 ]; then
        warn "实例尚无账号（首次初始化未完成），跳过演示账号创建，稍后重跑本脚本。"
    elif docker exec octop octop --json user list 2>/dev/null \
            | grep -qE "\"username\"[[:space:]]*:[[:space:]]*\"${DEMO_USERNAME}\""; then
        DEMO_STATE="ready"
        log "演示账号已存在：${DEMO_USERNAME}"
    elif docker exec octop octop user create "${DEMO_USERNAME}" \
            --password "${DEMO_PASSWORD}" --role admin >/dev/null 2>&1; then
        DEMO_STATE="ready"
        log "演示账号已创建：${DEMO_USERNAME} / ${DEMO_PASSWORD}"
    else
        warn "演示账号创建失败，可手动执行："
        warn "  ${DEMO_HINT_CMD}"
    fi
fi

# ---------------------------------------------------------------------------
# 6. 打印凭据
# ---------------------------------------------------------------------------
echo
echo "==================================================================="
echo "  Octop 已启动"
echo "  访问地址 : http://localhost:${PORT}"
if [ "${USE_POSTGRES}" -eq 1 ]; then
echo "  数据库   : PostgreSQL (容器 octop-postgres, 端口 5432)"
else
echo "  数据库   : SQLite (${DATA_DIR}/octop.db)"
fi
echo "-------------------------------------------------------------------"
CRED_HOST="${DATA_DIR%/}/credential.txt"
case "${CRED_HOST}" in
    [A-Za-z]:/*) CRED_READ="/$(printf '%s' "${CRED_HOST%%:*}" | tr 'A-Z' 'a-z')/${CRED_HOST#*:/}" ;;
    *) CRED_READ="${CRED_HOST}" ;;
esac
if [ -f "${CRED_READ}" ]; then
    echo "  首次登录凭据（${CRED_READ}）："
    sed 's/^/    /' "${CRED_READ}"
else
    echo "  首次登录凭据：容器仍在初始化，稍后查看"
    echo "    bash docker/octop-ctl.sh password"
fi
if [ "${DEMO_STATE}" = "ready" ]; then
    echo "-------------------------------------------------------------------"
    echo "  演示账号   : ${DEMO_USERNAME} / ${DEMO_PASSWORD}（登录页可一键填入）"
fi
echo "==================================================================="
echo "  管理命令："
echo "    停止   : bash docker/octop-ctl.sh down"
echo "    日志   : bash docker/octop-ctl.sh logs"
echo "    状态   : bash docker/octop-ctl.sh status"
echo "    密码   : bash docker/octop-ctl.sh password"
echo "==================================================================="
