#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./db.ts";
import { renderGrid } from "./grid.ts";
import { SAMPLES } from "./samples.ts";
import { NonogramService } from "./service.ts";
import { solve } from "./solver.ts";
import type { SolveOutcome } from "./types.ts";
import { validatePuzzle } from "./validate.ts";

const DATA_DIR = process.env.NONOGRAM_DATA ?? resolve("data");
const store = new Store(resolve(DATA_DIR, "nonogram.db"));
const service = new NonogramService(store);

function parseConfigArgs(args: string[]): { maxNodes?: number; maxTimeMs?: number; recordSteps?: boolean } {
  const cfg: { maxNodes?: number; maxTimeMs?: number; recordSteps?: boolean } = {};
  for (const a of args) {
    if (a.startsWith("--max-nodes=")) cfg.maxNodes = Number(a.split("=")[1]);
    if (a.startsWith("--max-time-ms=")) cfg.maxTimeMs = Number(a.split("=")[1]);
    if (a === "--no-record") cfg.recordSteps = false;
  }
  return cfg;
}

function printOutcome(o: SolveOutcome): string {
  switch (o) {
    case "unsatisfiable":
      return "无解（线索/已知格矛盾，搜索空间已穷尽）";
    case "unique":
      return "唯一解（已找到一个解并穷尽其余所有分支）";
    case "multiple":
      return "至少两个解（返回两份不同见证）";
    case "budget_exhausted":
      return "预算耗尽（未搜索完，结论为边界，不是无解）";
  }
}

function printSolve(result: ReturnType<typeof solve>, showSteps = false): void {
  console.log("结论:", printOutcome(result.outcome));
  console.log(
    `节点=${result.nodesVisited} 耗时=${result.elapsedMs}ms 已见解数=${result.solutionCount} 预算耗尽=${result.budgetExhausted}`,
  );
  if (result.boundary) console.log("边界:", result.boundary);
  result.witnesses.forEach((w, i) => {
    console.log(`--- 见证 ${i + 1} ---`);
    console.log(renderGrid(w));
  });
  if (showSteps) {
    console.log("--- 步骤 ---");
    for (const s of result.steps) {
      const tag = s.logical ? "[逻辑]" : "[猜测]";
      const label = s.orientation === "row" ? `行${s.index + 1}` : `列${s.index + 1}`;
      console.log(`${s.seq}. ${tag} ${label}: ${s.reason}`);
    }
  }
}

function loadPuzzleArg(arg: string) {
  if (arg.startsWith("sample:")) {
    const key = arg.slice("sample:".length);
    const p = (SAMPLES as Record<string, unknown>)[key] as Parameters<typeof structuredClone>[0] | undefined;
    if (!p) throw new Error(`未知样例 ${key}，可选: ${Object.keys(SAMPLES).join(", ")}`);
    return structuredClone(p);
  }
  const text = readFileSync(resolve(arg), "utf-8");
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "solve-file": {
        // 直接对文件/样例求解（不落库），便于快速验证
        const arg = rest[0];
        if (!arg) throw new Error("用法: solve-file <file.json|sample:name> [--max-nodes=N] [--max-time-ms=N] [--steps]");
        const puzzle = validatePuzzle(loadPuzzleArg(arg));
        const result = solve(puzzle, parseConfigArgs(rest));
        printSolve(result, rest.includes("--steps"));
        break;
      }
      case "import": {
        const arg = rest[0];
        if (!arg) throw new Error("用法: import <file.json|sample:name>");
        const raw = loadPuzzleArg(arg);
        const { puzzle, knownVersion } = service.importPuzzle(raw);
        console.log(`已导入 puzzleId=${puzzle.id} uuid=${puzzle.uuid} knownVersion=${knownVersion}`);
        break;
      }
      case "list": {
        for (const p of service.listPuzzles()) {
          console.log(`#${p.id} ${p.name ?? "(未命名)"} ${p.rows}x${p.cols} uuid=${p.uuid}`);
        }
        break;
      }
      case "check": {
        const id = Number(rest[0]);
        const v = rest.includes("--version") ? Number(rest[rest.indexOf("--version") + 1]) : undefined;
        console.log(JSON.stringify(service.check(id, v), null, 2));
        break;
      }
      case "known": {
        // known <id> '<json array>'  产生新版本
        const id = Number(rest[0]);
        const known = JSON.parse(rest[1] ?? "[]");
        const out = service.updateKnown(id, known);
        console.log("新已知格版本:", out.knownVersion);
        break;
      }
      case "solve": {
        const id = Number(rest[0]);
        let v: number | undefined;
        if (rest.includes("--version")) v = Number(rest[rest.indexOf("--version") + 1]);
        const out = service.solve(id, { knownVersion: v, config: parseConfigArgs(rest) });
        console.log(`resultId=${out.stored.id} knownVersion=${out.knownVersion}`);
        printSolve(out.result, rest.includes("--steps"));
        break;
      }
      case "hint": {
        const id = Number(rest[0]);
        let v: number | undefined;
        if (rest.includes("--version")) v = Number(rest[rest.indexOf("--version") + 1]);
        const h = service.hint(id, v);
        console.log(`可满足=${h.feasible} 已完成=${h.complete} 逻辑推出 ${h.steps.length} 步`);
        for (const s of h.steps) {
          const label = s.orientation === "row" ? `行${s.index + 1}` : `列${s.index + 1}`;
          const cells = s.cells.map((c) => `(${c.r + 1},${c.c + 1})=${c.v === 1 ? "黑" : "白"}`).join(" ");
          console.log(`${s.seq + 1}. [逻辑] ${label} -> ${cells}\n   ${s.reason}`);
        }
        break;
      }
      case "result": {
        const id = Number(rest[0]);
        const r = service.getResult(id);
        console.log(JSON.stringify({ ...r, result: JSON.parse(r.result), config: JSON.parse(r.config) }, null, 2));
        break;
      }
      case "results": {
        const id = Number(rest[0]);
        for (const r of service.listResults(id)) {
          console.log(`result#${r.id} v${r.known_version} ${r.outcome} ${r.created_at}`);
        }
        break;
      }
      case "reverse": {
        // reverse <file.txt>：文件每行一串 █/·
        const text = readFileSync(resolve(rest[0]!), "utf-8");
        const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        console.log(JSON.stringify(service.reverseClues(rows), null, 2));
        break;
      }
      case "export": {
        const id = Number(rest[0]);
        let v: number | undefined;
        if (rest.includes("--version")) v = Number(rest[rest.indexOf("--version") + 1]);
        console.log(JSON.stringify(service.export(id, v), null, 2));
        break;
      }
      default:
        console.log(
          [
            "命令:",
            "  solve-file <file.json|sample:name> [--steps] [--max-nodes=N] [--max-time-ms=N]",
            "  import <file.json|sample:name>",
            "  list",
            "  check <id> [--version v]",
            "  known <id> '<json数组>'   # 追加已知格，产生新版本",
            "  solve <id> [--version v] [--steps] [--max-nodes=N] [--max-time-ms=N]",
            "  hint <id> [--version v]",
            "  result <resultId>        # 读取持久化结果快照",
            "  results <puzzleId>",
            "  reverse <board.txt>      # 从完整棋盘反算线索",
            "  export <id> [--version v]",
            "",
            "样例: " + Object.keys(SAMPLES).join(", "),
          ].join("\n"),
        );
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("错误:", err.message);
  process.exitCode = 1;
});
