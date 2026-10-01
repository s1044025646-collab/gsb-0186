# 数织（Nonogram）行列约束求解与唯一性证明后端

纯本地、离线的黑白数织求解服务，只提供 **HTTP API** 与 **CLI**（无图形界面）。
使用 TypeScript + Node.js 内置能力 + 内置 SQLite（`node:sqlite`）实现，
**不依赖 Docker、WSL、任何付费服务或外部在线 API，也不调用任何现成数织/通用约束求解库**，
行列候选传播与回溯搜索均为自行实现。

## 运行环境

- Windows + PowerShell（已在 Node.js `v25.5.0` 验证；要求 `>= 22.5.0`，需支持 `node:sqlite` 与 `--experimental-strip-types`）。
- 安装依赖：`npm install`（仅安装 `typescript` 与 `@types/node`，运行时零第三方依赖）。

## 快速开始

```powershell
npm install
npm run build       # 类型检查（tsc，noEmit）
npm test            # 运行内置测试（含小棋盘穷举基准）
npm run demo        # 端到端演示（提示→求解→反算核对，多解/无解/预算耗尽/重启）
npm start           # 启动 HTTP API（默认端口 3000）
```

可配置端口与项目内数据目录（均为环境变量，无需改代码）：

```powershell
$env:PORT="8080"               # 或 NONOGRAM_PORT
$env:NONOGRAM_DATA="data"      # SQLite 数据目录（默认项目内 ./data）
npm start
```

## 题面格式（输入 JSON）

```json
{
  "name": "可选名称",
  "rows": 5,
  "cols": 5,
  "rowClues": [[1,1],[2,1],[1],[2,1],[1]],
  "colClues": [[2,1],[1,1],[1,1,1],[],[1,1]],
  "known": [ { "r": 0, "c": 0, "v": 1 } ]
}
```

- `rowClues`：每行一段连续黑格长度的有序列表；长度必须等于 `rows`。
- `colClues`：每列一段连续黑格长度的有序列表；长度必须等于 `cols`。
- **空线索 `[]` 表示该整行/整列必须全白**，绝不会被当作“任意内容”。
  因此“空列 + 全黑行”这类题面会被正确判为无解。
- `known`（可选）：已知格，`r`/`c` 从 0 开始，`v=1` 已知黑、`v=2` 已知白（叉号）；其余为未知。

### 导入校验

- 段长度必须为正整数。
- 每条线索的**最小占用长度** = 各段之和 + 段间至少一个白格；超过该方向长度直接拒绝导入。
- 已知格坐标必须落在棋盘内，同一坐标不得重复，值只能是 1 或 2。
- 棋盘单边最大 **64**（`src/validate.ts` 的 `MAX_DIMENSION`）。

## 输出的四类结论

`outcome` 字段严格取以下四值之一：

| outcome | 含义 |
| --- | --- |
| `unsatisfiable` | **无解**：搜索空间已完整穷尽（不是超时/取消）。 |
| `unique` | **唯一解**：找到 1 个解并证明其余所有分支均矛盾（找到一个解不会立刻宣称唯一）。 |
| `multiple` | **至少两个解**：`witnesses` 含两份**不同且都满足线索**的完整见证。 |
| `budget_exhausted` | **预算耗尽**：保存已发现解数量与当前结论边界；绝不等同于无解。 |

`budget_exhausted` 时返回 `boundary` 文案、`solutionCount`、`nodesVisited`、`elapsedMs`。
默认预算：`maxNodes=200000`、`maxTimeMs=10000ms`，均可在求解请求/CLI 参数中覆盖。

字符棋盘使用 `█`（黑）、`·`（白）、`?`（未知），结构化结果同时给出数字网格（1/2/0）。

## 算法（自行实现）

- **线性传播器**（`src/line.ts`）：对单条线做“块放置 DP”。
  用前缀/后缀可行性与计数 DP 枚举所有与已知格相容的合法摆放（时间约 O(k·n)），
  逐格判定“能否为黑 / 能否为白”，只能取其一即为必然格；无任何合法摆放即矛盾。
  空线索单独处理为“整线全白”。排列数封顶 10 亿，避免大数开销。
- **固定点传播**（`src/solver.ts`）：反复对所有行、列应用线性传播，直到无变化或矛盾。
- **带回溯的搜索**：传播后选候选摆放数最少的线（MRV）上的未知格，先试黑再试白；
  每访问一个节点计数并检查时间预算，找到 2 个解或预算耗尽即停。
- **唯一性**：必须在预算内穷尽其余分支才能给 `unique`；否则是 `budget_exhausted`。

## 提示与步骤记录

- `hint` 只做**根级固定点传播**，不做任何假设，因此返回的每一步都是“仅凭当前已知格与线索的必然黑白格”。
- 完整 `solve` 的 `steps` 会把搜索过程也记录下来：
  - `logical: true`：由线索与当前已知格必然推出（即使发生在某个假设分支内，条件必然仍标为逻辑步）；
  - `logical: false`：**回溯猜测**本身，明确标记“非必然结论，仅用于搜索分支”。
- 每条解释关联具体行/列、候选摆放数与候选排除原因（“所有候选中均为黑/白”），
  记录在推导当时生成，**不是事后用最终解伪造**。

## 版本与 SQLite 持久化

数据库位于 `NONOGRAM_DATA/nonogram.db`（默认 `./data/nonogram.db`），表结构：

- `puzzles`：谜题版本（尺寸、行/列线索、UUID）。
- `known_versions`：已知格版本（`(puzzle_id, version)` 唯一）。导入生成版本 1，
  每次修改已知格**追加新版本**，不改动旧版本。
- `solve_configs` / `results`：求解配置与结果快照（含结论、见证、节点数、边界、步骤）。

在新版本上求解只会新增结果行，**旧版本的解永远不会被污染或覆盖**；关闭进程后重开数据库可继续读取历史结果。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回数据库路径 |
| POST | `/puzzles` | 导入题面（完整校验），返回 `puzzleId` 与 `knownVersion` |
| GET | `/puzzles` | 列出谜题 |
| GET | `/puzzles/:id?knownVersion=` | 检查/取回某版本题面 |
| POST | `/puzzles/:id/known` | body `{ "known": [...] }`，追加已知格，产生新版本 |
| POST | `/puzzles/:id/solve` | body 可选 `{ "knownVersion":1, "config":{...} }`，求解并保存快照 |
| GET | `/puzzles/:id/hint?knownVersion=` | 纯逻辑下一步提示 |
| GET | `/puzzles/:id/results` | 列出该谜题全部结果 |
| GET | `/puzzles/:id/export?knownVersion=` | 导出题面 + 该版本结果快照 |
| GET | `/results/:id` | 读取某条持久化结果快照 |
| POST | `/reverse-clues` | body `{ "rows": ["█·█··", ...] }`，从完整棋盘反算线索 |

示例：

```powershell
# 导入
curl.exe -X POST http://localhost:3000/puzzles -H "content-type: application/json" `
  --data-binary "@examples/partial.json"
# 求解（假设返回 puzzleId=1）
curl.exe -X POST http://localhost:3000/puzzles/1/solve -H "content-type: application/json" -d "{}"
# 极小预算，观察 budget_exhausted
curl.exe -X POST http://localhost:3000/puzzles/1/solve -H "content-type: application/json" `
  -d "{\"config\":{\"maxNodes\":5}}"
```

## CLI

```powershell
# 不落库，直接求解文件或内置样例（最快验证）
node --experimental-strip-types src/cli.ts solve-file sample:multiple --steps
node --experimental-strip-types src/cli.ts solve-file examples/partial.json
node --experimental-strip-types src/cli.ts solve-file sample:symmetric --max-nodes=5

# 持久化流程
node --experimental-strip-types src/cli.ts import examples/partial.json
node --experimental-strip-types src/cli.ts list
node --experimental-strip-types src/cli.ts hint 1
node --experimental-strip-types src/cli.ts solve 1 --steps
node --experimental-strip-types src/cli.ts known 1 '[{"r":4,"c":4,"v":1}]'   # 产生已知格版本 2
node --experimental-strip-types src/cli.ts solve 1 --version 2
node --experimental-strip-types src/cli.ts results 1
node --experimental-strip-types src/cli.ts result 1
node --experimental-strip-types src/cli.ts reverse examples/board.txt
node --experimental-strip-types src/cli.ts export 1
```

内置样例：`symmetric`（5x5 对称、唯一）、`nonsquare`（4x6、唯一）、
`contradiction`（明确矛盾）、`multiple`（2x2 两个对角线解）、
`partial`（部分完成，用于提示演示）、`knownConflict`（已知格冲突）。

## 测试基准

`test/` 内置：

- **小棋盘穷举基准**：随机生成 1×1～4×4 题面，用 2^(r·c) 暴力枚举统计解数，
  与求解器的无解/唯一/多解结论逐一比对（60 组）。
- 空白棋盘（全空线索唯一全白）、线索刚好填满、黑段间最小白格拒绝导入、
  已知格冲突、极小预算返回 `budget_exhausted` 且边界文案明确“不能判定无解”、
  多解两份见证、非方形/对称样例、以及**关闭后重开 SQLite 读取结果**与**版本隔离**。

## 设计取舍与限制

- 只做后端：无前端、无静态页面。
- 运行依赖 Node 的实验特性 `node:sqlite` 与 TypeScript 擦除执行（Node 22.5+/23/25 可用）；
  `npm run build` 是严格类型检查（`noEmit`），运行时由 Node 直接擦除类型执行 `src/*.ts`。
- 最大棋盘单边 64、默认 20 万节点 / 10 秒；极端高自由度大棋盘可能在预算内无法证明唯一性，
  此时如实返回 `budget_exhausted` 与边界，而不会谎称唯一或无解。
- `multiple` 固定保存前两份不同见证（找到 2 份即足以证明“至少两个”），不枚举全部解。
