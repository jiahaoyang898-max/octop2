# Octop 一键启动（Docker）

一条命令（或双击一次）把 Octop 及其可选数据库跑起来，不需要预先装 Node / Python / uv。

---

## 快速开始

### Windows（双击）

双击 `docker\octop-up.cmd` 即可。默认使用 SQLite，零外部依赖，最适合先跑通。

需要 PostgreSQL 时，在命令行里执行：

```cmd
octop-up.cmd --postgres
```

### 命令行 / Git Bash / macOS / Linux

```bash
# 最简：SQLite 模式
bash docker/octop-up.sh

# 带 PostgreSQL(pgvector)
bash docker/octop-up.sh --postgres

# 国内网络加速构建（走腾讯云镜像源）
bash docker/octop-up.sh --mirror

# 换端口 / 换数据目录
bash docker/octop-up.sh --port 9090 --data /d/octop-data/.octop
```

启动脚本会自动完成：环境检查 → 创建数据目录 → 构建并启动 → 轮询 `/api/health` 直到就绪 → 幂等确保演示账号 `demo` 存在 → 打印访问地址与首次登录凭据。

启动后访问 **http://localhost:8088**。

---

## 演示账号（登录页「一键填入」）

登录页右侧有一条「演示账号一键填入」，凭据写死在前端（`demo` / `Demo@2026`）。后端没有这个账号时，填进去的账号必然登录失败，所以一键启动会在服务就绪后把它补上，等价于：

```bash
docker exec octop octop --json user list                          # 已存在 → 跳过
docker exec octop octop user create demo --password "Demo@2026" --role admin
```

要点：

- **时序**：只在 `/api/health` 通过、且实例已有账号（`users_loaded > 0`，即容器入口脚本的 `octop init` 已建好首个管理员）之后创建。CLI 离线开库会顺带跑迁移，实例还没有任何账号时会让它抢先建库、把首次初始化顶掉。
- **幂等**：账号已存在就跳过，重复执行启动脚本不报错、也不会建重复账号。
- **PostgreSQL 模式**：容器已注入 `OCTOP_DATABASE_*`，CLI 连的是同一个库，行为与 SQLite 一致。
- **角色是 admin**：与云端演示实例保持一致，便于演示全部模块。不想要演示账号，删掉 `octop-up.sh` 的「5.5 演示账号」段 / `octop-up.cmd` 的「Demo account」段即可。
- ⚠️ **改凭据要动两处**：同一组凭据还定义在 `dashboard/src/pages/Login/index.tsx`（`DEMO_USERNAME` / `DEMO_PASSWORD`），只改一边会让演示条填入一个不存在的账号。
- 前端另有兜底：登录页先探测该账号能否登录，探测不通（账号不存在 / 后端不可达）就不渲染演示条。

---

## 首次登录凭据

`OCTOP_DEFAULT_PASSWORD` 留空时，容器首次启动会**自动生成随机强密码**，写入数据目录下的 `credential.txt`：

```
D:\octop-data\.octop\credential.txt
```

查看方式：

```bash
bash docker/octop-ctl.sh password      # 或  octop-ctl.cmd password
```

首次登录后请立即改密（右上角头像 → 修改密码）。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `docker-compose.oneclick.yml` | 一键启动编排（自包含）。含 octop 应用 + 可选 PostgreSQL，数据盘默认落 D 盘 |
| `oneclick.env` | 一键启动的默认配置（端口、数据目录、初始管理员、LLM Key 等） |
| `octop-up.sh` / `octop-up.cmd` | 启动脚本（bash / Windows 双击） |
| `octop-ctl.sh` / `octop-ctl.cmd` | 管理脚本（status / logs / password / restart / down / nuke / shell） |
| `docker-compose.yml` | 官方原始编排（上游文件，保持不动） |
| `Dockerfile` | 官方多阶段构建（前端 vite 打包 → Python 运行时） |

### 与官方文件的关系

一键启动没有修改任何官方文件，而是在其基础上做了一层**自包含编排**，语义与官方 `docker-compose.yml` 等价。三处增强：

1. **数据盘默认落 D 盘**（官方默认 `~/.octop`，即 C 盘）；
2. **内置可选 PostgreSQL**，与 octop 同网络，用 `postgres` 主机名直连，无需 `host.docker.internal`；
3. **补齐 `depends_on` + `healthcheck`**，保证数据库就绪后再拉起应用。

---

## 常用管理命令

```bash
bash docker/octop-ctl.sh status      # 容器状态 + 健康检查
bash docker/octop-ctl.sh logs        # 跟随日志
bash docker/octop-ctl.sh password    # 查看首次登录凭据
bash docker/octop-ctl.sh restart     # 重启
bash docker/octop-ctl.sh down        # 停止并移除容器（数据保留）
bash docker/octop-ctl.sh shell       # 进容器
bash docker/octop-ctl.sh nuke        # 危险：连数据一起删除（需输入 YES 确认）
```

Windows 版：把 `octop-ctl.sh <命令>` 换成 `octop-ctl.cmd <命令>`。

---

## 配置项

改 `docker/oneclick.env`，然后重新执行启动脚本即可（改端口/密码无需重新构建）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OCTOP_PORT` | `8088` | HTTP 端口 |
| `OCTOP_DATA` | `D:/octop-data/.octop` | 宿主数据目录（SQLite 库 + 会话 + 配置） |
| `OCTOP_DEFAULT_PASSWORD` | _(空)_ | 留空 = 自动生成随机强密码并写入 `credential.txt` |
| `OCTOP_ADMIN_USERNAME` | `admin` | 首次管理员用户名 |
| `OPENAI_API_KEY` / `DASHSCOPE_API_KEY` | _(空)_ | 也可稍后在控制台里配 |
| `LANGFUSE_TRACING_ENABLED` | `false` | 未配 Langfuse 时关掉，减少日志噪音 |
| `OCTOP_PG_*` | `octop` | 仅 `--postgres` 模式使用的库名/账号/密码/端口 |

> 注意：Compose 只会把 `docker-compose.oneclick.yml` 的 `environment:` 段里列出的键注入容器。要新增注入项，需同步修改该段。

---

## 故障排查

### 1. 构建报 `tls: bad record MAC`

这是 Docker Desktop 在 Windows/WSL2 下的**传输层瞬时抖动**，与代码无关。直接重试即可 —— 已完成的层会走缓存：

```bash
bash docker/octop-up.sh --no-build   # 若镜像已构建成功，跳过构建直接起
```

### 2. ⚠️ C 盘被占满（重要）

**Docker Desktop 默认把镜像、容器、构建缓存全部存在 C 盘**（`C:\Users\<你>\AppData\Local\Docker\wsl\`）。Octop 镜像约 678MB，加上构建缓存与基础镜像，一次完整构建会占用若干 GB。

本机 C 盘剩余空间紧张，构建过程中一度被压到 1.7GB，导致工具链写入失败、Docker 守护进程无响应。

**建议把 Docker 数据目录迁到 D 盘**（一次性操作，可长期受益）：

1. Docker Desktop → 右上角齿轮 **Settings** → **Resources** → **Advanced**；
2. **Disk image location** 改为 `D:\DockerData`；
3. 点击 **Apply & restart**（Docker 会把现有数据迁过去，耗时取决于镜像体积）。

迁移后重新执行启动脚本即可。数据目录 `D:\octop-data` 只放 Octop 的业务数据（很小），与 Docker 引擎数据是两回事。

### 3. 守护进程无响应（`docker ps` 卡住）

C 盘打满后 Docker 引擎可能被拖死，表现为 CLI 能打印版本号（`docker --version` 正常）但连不上守护进程。**重启 Docker Desktop 即可恢复**。

### 4. 端口 8088 被占用

改 `docker/oneclick.env` 里的 `OCTOP_PORT`，或启动时加 `--port 9090`。

### 5. 服务起不来 / 想看日志

```bash
docker logs -f --tail 200 octop
# 或
bash docker/octop-ctl.sh logs
```

### 6. 健康检查

```bash
curl --noproxy '*' http://127.0.0.1:8088/api/health
```

> 本机若开了系统代理，`curl` 访问 localhost 需加 `--noproxy '*'`，否则会被代理劫持返回 502。
