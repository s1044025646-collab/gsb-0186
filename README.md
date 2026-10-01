# 数织(Nonogram)求解与唯一性证明后端

黑白数织谜题的离线求解服务。仅提供 API 与 CLI, 无图形界面。TypeScript + Node.js + SQLite(`node:sqlite`, 无原生依赖), Windows 本地直接运行, 不依赖 Docker / WSL / 外部服务。

## 环境要求

- Node.js >= 22.5(使用内置 `node:sqlite`; 开发环境为 Node 25)
- 仅开发依赖: `typescript`, `@types/node`

## 快速开始

```powershell
npm install
npm run build     # 编译到 dist/
npm test          # 构建并运行全部测试
npm run seed      # 导入内置示例谜题(对称/非方形/矛盾/多解/部分完成)
npm run demo      # 演示: 提示->求解->反算核对 / 多解见证 / 预算耗尽
npm start         # 启动 API, 默认端口 8377, 用 $env:PORT 覆盖
npm run cli -- <命令>   # CLI 入口
```

数据目录默认为项目内 `data/`, 可用环境变量 `NONOGRAM_DATA_DIR` 或 `NONOGRAM_DB` 覆盖。

## 题面格式

```json
{
  "name": "cross",
  "rows": 5, "cols": 5,
  "rowClues": [[1], [1], [5], [1], [1]],
  "colClues": [[1], [1], [5], [1], [1]],
  "givens": [{ "row": 2, "col": 0, "value": "black" }]
}
```

- 线索为连续黑格段长度数组; **空数组 `[]` 明确表示整行/列无黑格**, 不会被误解为"任意"。`null`/缺失会被拒绝。
- 导入时校验: 段长度为正整数、最小占用长度(段长之和 + 段数-1)不超过线长、已知格坐标在界内且取值为 `black`/`white`。
- 棋盘规模上限 64x64。字符棋盘: `#` 黑, `.` 白, `?` 未知。

## 求解语义

自行实现行列候选传播(BigInt 位掩码)+ 带回溯搜索, 未使用任何现成求解器。四种结果:

| status | 含义 |
|---|---|
| `unsat` | 搜索空间穷尽, 确认无解 |
| `unique` | 搜索空间穷尽, 仅 1 个解(找到 1 个解不会直接称唯一) |
| `multiple` | 找到 2 个不同解, 返回两份见证 |
| `budget_exceeded` | 节点/时间预算耗尽, 附已发现解数与结论边界, **不得视为无解** |

预算配置(`SolveConfig`): `maxNodes`(默认 20 万)、`maxTimeMs`(默认 10 秒)、`maxSolutions`(默认 2)、`maxCandidatesPerLine`(默认 20 万)。

## 提示与步骤记录

- `hint` 只做候选传播: 返回的每格都是当前已知格 + 线索下的**逻辑必然**, 附关联行列与候选排除原因, 不做事后伪造。
- 求解步骤日志中, 传播步标记 `propagate`, 搜索分支标记 `guess`(依赖猜测)。

## 持久化

SQLite 三张表: `puzzles`(题面)、`versions`(已知格版本, 每次修改已知格产生新版本, 旧版本与其求解结果不被污染)、`solve_runs`(求解配置 + 结果快照 + 步骤日志)。重启后可通过 `runs`/`run` 查询历史结果。

## API(默认 http://localhost:8377)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/puzzles` | 导入谜题, 返回 `{puzzleId, versionId}` |
| GET | `/puzzles` / `/puzzles/:id` | 列表 / 详情 |
| POST | `/puzzles/:id/check` | 校验题面 |
| POST | `/puzzles/:id/givens` | 修改已知格, 产生新版本 |
| GET | `/puzzles/:id/export?versionId=` | 导出题面与字符棋盘 |
| POST | `/solve` | `{versionId, config?}` 求解并存快照 |
| POST | `/hint` | `{versionId}` 逻辑提示 |
| GET | `/runs?versionId=` / `/runs/:id` | 求解记录查询 |
| POST | `/clues/from-board` | `{board: "文本棋盘"}` 反算行列线索 |

## CLI

```
node dist/src/cli.js seed                          导入内置示例
node dist/src/cli.js import <file|json>            导入谜题
node dist/src/cli.js list                          列出谜题
node dist/src/cli.js check <file|json>             校验题面
node dist/src/cli.js givens <puzzleId> <file|json> 修改已知格(新版本)
node dist/src/cli.js solve <versionId> [config]    求解
node dist/src/cli.js hint <versionId>              逻辑提示
node dist/src/cli.js runs [versionId]              求解记录
node dist/src/cli.js run <runId>                   单次结果快照
node dist/src/cli.js from-board <file|文本>        完整棋盘反算线索
node dist/src/cli.js export <puzzleId> [versionId] 导出
```

## 测试

`npm test` 覆盖: 空白棋盘、线索刚好填满、黑段间最小白格、已知格冲突、多解见证、预算极小、空线索语义、非法输入拒绝、提示纯逻辑性、反算线索、<=3x3 穷举基准交叉验证(无解/唯一/多解)、SQLite 版本隔离与重启后读取。

## 限制

- 棋盘最大 64x64; 单行候选数与搜索节点/时间受预算限制, 超出返回 `budget_exceeded` 而非错误结论。
- 穷举基准仅用于 <=25 格的小棋盘测试。
- `node:sqlite` 在 Node 25 仍标记 experimental, 会有启动警告, 不影响功能。
