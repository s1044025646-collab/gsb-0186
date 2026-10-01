/**
 * 演示脚本:
 * 1) 部分完成题面 -> 获取提示 -> 求解 -> 反算线索核对
 * 2) 多解题 -> 展示两份不同见证
 * 3) 预算极小 -> 展示 budget_exceeded 的边界说明
 */
import { openDb, createPuzzle, getPuzzle, getVersion, saveRun } from "./db";
import { givensToBoard, renderBoard, parseBoard, cluesFromBoard } from "./puzzle";
import { solve, hint } from "./solver";
import * as fs from "node:fs";
import * as path from "node:path";

const demoDb = path.join(process.cwd(), "data", "demo.db");
if (fs.existsSync(demoDb)) fs.unlinkSync(demoDb);
const db = openDb(demoDb);

function line(t: string) { console.log(`\n=== ${t} ===`); }

// --- 演示 1: 部分完成 -> 提示 -> 求解 -> 反算核对 ---
line("演示 1: 部分完成的十字(5x5)");
const { puzzleId, versionId } = createPuzzle(db, {
  name: "demo-cross",
  rows: 5, cols: 5,
  rowClues: [[1], [1], [5], [1], [1]],
  colClues: [[1], [1], [5], [1], [1]],
  givens: [
    { row: 2, col: 0, value: "black" },
    { row: 0, col: 2, value: "black" },
  ],
});
const p = getPuzzle(db, puzzleId);
const v = getVersion(db, versionId);
const board0 = givensToBoard(p.rows, p.cols, v.givens);
console.log("初始棋盘:\n" + renderBoard(board0, p.rows, p.cols));

const h = hint({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board: board0 });
console.log(`\n提示: ${h.note}`);
for (const c of h.hints.slice(0, 6)) console.log(`  (${c.row},${c.col})=${c.value === "black" ? "#" : "."} <- ${c.reason}`);

const r1 = solve({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board: board0 });
saveRun(db, versionId, {}, r1);
console.log(`\n求解: status=${r1.status} 节点=${r1.nodes} 用时=${r1.elapsedMs}ms`);
console.log(r1.bound);
console.log("解棋盘:\n" + r1.solutions[0]);

const parsed = parseBoard(r1.solutions[0]);
const back = cluesFromBoard(parsed.board, parsed.rows, parsed.cols);
const match = JSON.stringify(back.rowClues) === JSON.stringify(p.row_clues) &&
              JSON.stringify(back.colClues) === JSON.stringify(p.col_clues);
console.log(`反算线索与原线索一致: ${match}`);

// --- 演示 2: 多解见证 ---
line("演示 2: 多解题(2x2 对角)");
const m = createPuzzle(db, {
  name: "demo-multi", rows: 2, cols: 2,
  rowClues: [[1], [1]], colClues: [[1], [1]],
});
const mp = getPuzzle(db, m.puzzleId);
const mv = getVersion(db, m.versionId);
const r2 = solve({ rows: 2, cols: 2, rowClues: mp.row_clues, colClues: mp.col_clues, board: givensToBoard(2, 2, mv.givens) });
saveRun(db, m.versionId, {}, r2);
console.log(`status=${r2.status} ${r2.bound}`);
r2.solutions.forEach((s, i) => console.log(`见证 ${i + 1}:\n${s}`));
console.log(`两份见证不同: ${r2.solutions[0] !== r2.solutions[1]}`);

// --- 演示 3: 预算耗尽 ---
line("演示 3: 预算极小(maxNodes=1)");
const r3 = solve(
  { rows: 3, cols: 3, rowClues: [[1], [1], [1]], colClues: [[1], [1], [1]], board: givensToBoard(3, 3, []) },
  { maxNodes: 1, maxTimeMs: 60_000 }
);
console.log(`status=${r3.status}`);
console.log(r3.bound);
console.log("(预算耗尽不是无解, 已发现解数与结论边界见上)");
