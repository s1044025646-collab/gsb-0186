#!/usr/bin/env node
import { openDb, createPuzzle, getPuzzle, listPuzzles, getVersion, getLatestVersion, addGivensVersion, saveRun, getRun, listRuns } from "./db";
import { givensToBoard, renderBoard, parseBoard, cluesFromBoard } from "./puzzle";
import { solve, hint } from "./solver";
import { seedAll } from "./seed";
import * as fs from "node:fs";

const db = openDb();
const [, , cmd, ...args] = process.argv;

function readJson(arg: string): any {
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, "utf8"));
  return JSON.parse(arg);
}

function loadVersion(versionId?: number, puzzleId?: number) {
  const v = versionId ? getVersion(db, versionId) : puzzleId ? getLatestVersion(db, puzzleId) : null;
  if (!v) throw new Error("找不到版本, 请提供 versionId 或 puzzleId");
  const p = getPuzzle(db, v.puzzle_id);
  return { p, v };
}

function main() {
  switch (cmd) {
    case "seed": {
      const seeded = seedAll(db);
      for (const s of seeded) console.log(`${s.key}: puzzleId=${s.puzzleId} versionId=${s.versionId}`);
      break;
    }
    case "import": {
      // cli import <file.json|json>
      const body = readJson(args[0]);
      const { puzzleId, versionId } = createPuzzle(db, body);
      console.log(JSON.stringify({ puzzleId, versionId }));
      break;
    }
    case "list": {
      console.log(JSON.stringify(listPuzzles(db), null, 2));
      break;
    }
    case "check": {
      // cli check <file.json|json>
      const body = readJson(args[0]);
      try {
        const { validatePuzzleInput } = require("./puzzle");
        validatePuzzleInput(body);
        console.log("OK: 题面校验通过");
      } catch (e) {
        console.error(`校验失败: ${(e as Error).message}`);
        process.exitCode = 1;
      }
      break;
    }
    case "givens": {
      // cli givens <puzzleId> <givens.json|json>
      const versionId = addGivensVersion(db, Number(args[0]), readJson(args[1]));
      console.log(JSON.stringify({ versionId }));
      break;
    }
    case "solve": {
      // cli solve <versionId> [config.json|json]
      const { p, v } = loadVersion(Number(args[0]));
      const config = args[1] ? readJson(args[1]) : {};
      const board = givensToBoard(p.rows, p.cols, v.givens);
      const result = solve({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board }, config);
      const runId = saveRun(db, v.id, config, result);
      console.log(`runId=${runId} status=${result.status} 解数=${result.solutionsFound} 节点=${result.nodes} 用时=${result.elapsedMs}ms`);
      console.log(result.bound);
      result.solutions.forEach((s, i) => console.log(`--- 解 ${i + 1} ---\n${s}`));
      break;
    }
    case "hint": {
      // cli hint <versionId>
      const { p, v } = loadVersion(Number(args[0]));
      const board = givensToBoard(p.rows, p.cols, v.givens);
      const h = hint({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board });
      console.log(h.note);
      for (const c of h.hints) console.log(`(${c.row},${c.col}) = ${c.value === "black" ? "#" : "."}  [${c.reason}]${c.guess ? " [猜测]" : ""}`);
      break;
    }
    case "runs": {
      // cli runs [versionId]
      console.log(JSON.stringify(listRuns(db, args[0] ? Number(args[0]) : undefined), null, 2));
      break;
    }
    case "run": {
      // cli run <runId>
      const r = getRun(db, Number(args[0]));
      if (!r) { console.error("run 不存在"); process.exitCode = 1; break; }
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "from-board": {
      // cli from-board <board.txt|文本>
      const text = fs.existsSync(args[0]) ? fs.readFileSync(args[0], "utf8") : args[0];
      const { board, rows, cols } = parseBoard(text);
      console.log(JSON.stringify({ rows, cols, ...cluesFromBoard(board, rows, cols) }, null, 2));
      break;
    }
    case "export": {
      // cli export <puzzleId> [versionId]
      const { p, v } = loadVersion(args[1] ? Number(args[1]) : undefined, Number(args[0]));
      const board = givensToBoard(p.rows, p.cols, v.givens);
      console.log(JSON.stringify({ puzzle: p, version: v }, null, 2));
      console.log(renderBoard(board, p.rows, p.cols));
      break;
    }
    default:
      console.log(`用法: node dist/src/cli.js <命令>
  seed                          导入内置示例谜题
  import <file|json>            导入谜题
  list                          列出谜题
  check <file|json>             校验题面
  givens <puzzleId> <file|json> 修改已知格(产生新版本)
  solve <versionId> [config]    求解(config: {maxNodes,maxTimeMs,maxSolutions})
  hint <versionId>              获取逻辑提示
  runs [versionId]              列出求解记录
  run <runId>                   查看单次求解结果快照
  from-board <file|文本>        从完整棋盘反算线索
  export <puzzleId> [versionId] 导出谜题与已知格棋盘`);
  }
}

main();
