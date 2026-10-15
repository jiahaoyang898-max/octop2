#!/usr/bin/env bash
# =============================================================================
# Octop 容器管理（bash / Git Bash / WSL / macOS / Linux）
#
# 用法：
#   bash docker/octop-ctl.sh status     # 容器状态 + 健康检查结果
#   bash docker/octop-ctl.sh logs       # 跟随应用日志（Ctrl+C 退出）
#   bash docker/octop-ctl.sh password   # 打印首次登录凭据
#   bash docker/octop-ctl.sh restart    # 重启
#   bash docker/octop-ctl.sh down       # 停止并移除容器（数据保留）
#   bash docker/octop-ctl.sh nuke       # 停止并删除数据卷/数据目录（危险，需二次确认）
#   bash docker/octop-ctl.sh shell      # 进入容器 shell
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/oneclick.env"
COMPOSE_ONE="${SCRIPT_DIR}/docker-compose.oneclick.yml"

log() { printf '\033[36m[octop]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[octop]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未找到 docker。"

COMPOSE_ARGS=(compose --env-file "${ENV_FILE}" -f "${COMPOSE_ONE}")
PORT="$(sed -n 's/^OCTOP_PORT=//p' "${ENV_FILE}" | head -1)"; PORT="${PORT:-8088}"
DATA_DIR="$(sed -n 's/^OCTOP_DATA=//p' "${ENV_FILE}" | head -1)"

to_read_path() {
    case "$1" in
        [A-Za-z]:/*) printf '/%s/%s' "$(printf '%s' "${1%%:*}" | tr 'A-Z' 'a-z')" "${1#*:/}" ;;
        *) printf '%s' "$1" ;;
    esac
}

CMD="${1:-status}"
shift || true

case "${CMD}" in
    status)
        log "容器状态："
        docker ps -a --filter "name=octop" \
            --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
        echo
        log "健康检查 http://127.0.0.1:${PORT}/api/health :"
        if curl -fsS --noproxy '*' --max-time 8 "http://127.0.0.1:${PORT}/api/health"; then
            echo; log "服务正常 ✅"
        else
            echo "  未通过（服务未就绪或已停止）"
        fi
        ;;

    logs)
        docker logs -f --tail 200 octop
        ;;

    password)
        CRED="$(to_read_path "${DATA_DIR%/}/credential.txt")"
        if [ -f "${CRED}" ]; then
            cat "${CRED}"
        else
            warn_msg="凭据文件尚未生成（容器可能还在首次初始化）。"
            printf '\033[33m[octop]\033[0m %s\n' "${warn_msg}"
            log "容器内实时查看："
            docker exec octop sh -c 'cat "${HOME}/.octop/credential.txt" 2>/dev/null' || true
        fi
        ;;

    restart)
        ( cd "${REPO_ROOT}" && docker "${COMPOSE_ARGS[@]}" restart )
        log "已重启。"
        ;;

    down)
        ( cd "${REPO_ROOT}" && docker "${COMPOSE_ARGS[@]}" down --remove-orphans )
        log "已停止并移除容器（数据目录 ${DATA_DIR} 保留）。"
        ;;

    nuke)
        printf '\033[31m⚠️  此操作非常危险，可能导致不可逆的数据丢失！\033[0m\n'
        echo "将要删除："
        echo "  - 容器 octop / octop-postgres"
        echo "  - 数据卷 octop_pgdata（PostgreSQL 数据）"
        echo "  - 数据目录 ${DATA_DIR}（SQLite 库 + 全部会话/配置）"
        echo
        printf '确认请输入大写的 YES：'
        read -r ANSWER
        [ "${ANSWER}" = "YES" ] || die "已取消。"
        ( cd "${REPO_ROOT}" && docker "${COMPOSE_ARGS[@]}" --profile postgres down -v --remove-orphans ) || true
        if [ -n "${DATA_DIR}" ]; then
            REAL="$(to_read_path "${DATA_DIR}")"
            case "${REAL}" in
                /|/*|"${HOME}"|"${HOME}/") die "拒绝删除可疑路径：${REAL}" ;;
            esac
            rm -rf "${REAL}"
            log "已删除数据目录 ${REAL}"
        fi
        ;;

    shell)
        docker exec -it octop bash || docker exec -it octop sh
        ;;

    -h|--help|help)
        sed -n '2,15p' "${BASH_SOURCE[0]}"
        ;;

    *)
        die "未知命令: ${CMD}（用 help 查看用法）"
        ;;
esac
