import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { solve, hint } from "../src/solver";
import { validatePuzzleInput, givensToBoard, parseBoard, cluesFromBoard, ValidationError } from "../src/puzzle";
import { exhaustiveCount } from "../src/exhaustive";
import { openDb, createPuzzle, getVersion, saveRun, getRun, addGivensVersion, getLatestVersion } from "../src/db";
import { UNKNOWN } from "../src/types";

const empty = (rows: number, cols: number) => new Uint8Array(rows * cols).fill(UNKNOWN);

test("空白棋盘(全白线索) -> 唯一解全白", () => {
  const r = solve({ rows: 3, cols: 3, rowClues: [[], [], []], colClues: [[], [], []], board: empty(3, 3) });
  assert.equal(r.status, "unique");
  assert.equal(r.solutions[0], "...\n...\n...");
});

test("线索刚好填满 -> 唯一解全黑", () => {
  const r = solve({ rows: 2, cols: 3, rowClues: [[3], [3]], colClues: [[2], [2], [2]], board: empty(2, 3) });
  assert.equal(r.status, "unique");
  assert.equal(r.solutions[0], "###\n###");
});

test("黑段间最小白格: [1,1] 在长度 3 中唯一", () => {
  const r = solve({ rows: 1, cols: 3, rowClues: [[1, 1]], colClues: [[1], [], [1]], board: empty(1, 3) });
  assert.equal(r.status, "unique");
  assert.equal(r.solutions[0], "#.#");
});

test("已知格与线索冲突 -> 无解", () => {
  const board = givensToBoard(2, 2, [{ row: 0, col: 0, value: "white" }]);
  const r = solve({ rows: 2, cols: 2, rowClues: [[2], [2]], colClues: [[2], [2]], board });
  assert.equal(r.status, "unsat");
  assert.equal(r.solutionsFound, 0);
});

test("多解题返回两份不同见证", () => {
  const r = solve({ rows: 2, cols: 2, rowClues: [[1], [1]], colClues: [[1], [1]], board: empty(2, 2) });
  assert.equal(r.status, "multiple");
  assert.equal(r.solutionsFound, 2);
  assert.notEqual(r.solutions[0], r.solutions[1]);
});

test("预算极小 -> budget_exceeded 且不算无解", () => {
  const r = solve(
    { rows: 4, cols: 4, rowClues: [[1], [1], [1], [1]], colClues: [[1], [1], [1], [1]], board: empty(4, 4) },
    { maxNodes: 1, maxTimeMs: 60_000 }
  );
  assert.equal(r.status, "budget_exceeded");
  assert.match(r.bound, /不得视为无解/);
});

test("穷举基准交叉验证(<=3x3)", () => {
  const cases: Array<{ rows: number; cols: number; rowClues: number[][]; colClues: number[][] }> = [
    { rows: 2, cols: 2, rowClues: [[1], [1]], colClues: [[1], [1]] },
    { rows: 2, cols: 2, rowClues: [[2], []], colClues: [[1], [1]] },
    { rows: 2, cols: 2, rowClues: [[2], [2]], colClues: [[1], [1]] },
    { rows: 3, cols: 3, rowClues: [[1, 1], [1], []], colClues: [[1], [1, 1], [1]] },
    { rows: 3, cols: 3, rowClues: [[3], [1], [3]], colClues: [[2], [2], [2]] },
  ];
  for (const c of cases) {
    const ex = exhaustiveCount(c.rows, c.cols, c.rowClues, c.colClues);
    const r = solve({ rows: c.rows, cols: c.cols, rowClues: c.rowClues, colClues: c.colClues, board: empty(c.rows, c.cols) });
    if (ex.count === 0) assert.equal(r.status, "unsat", JSON.stringify(c));
    else if (ex.count === 1) assert.equal(r.status, "unique", JSON.stringify(c));
    else assert.equal(r.status, "multiple", JSON.stringify(c));
    assert.equal(Math.min(ex.count, 2), r.solutionsFound);
  }
});

test("校验: 空线索不被误解, 非法输入被拒绝", () => {
  assert.throws(() => validatePuzzleInput({ rows: 2, cols: 2, rowClues: [null as any, []], colClues: [[], []] }), ValidationError);
  assert.throws(() => validatePuzzleInput({ rows: 1, cols: 2, rowClues: [[3]], colClues: [[], []] }), ValidationError);
  assert.throws(() => validatePuzzleInput({ rows: 2, cols: 2, rowClues: [[], []], colClues: [[], []], givens: [{ row: 5, col: 0, value: "black" }] }), ValidationError);
  assert.throws(() => validatePuzzleInput({ rows: 100, cols: 2, rowClues: [], colClues: [] }), ValidationError);
  const r = solve({ rows: 1, cols: 2, rowClues: [[]], colClues: [[], []], board: empty(1, 2) });
  assert.equal(r.solutions[0], "..");
});

test("提示: 仅逻辑推出, 不猜测", () => {
  const board = givensToBoard(5, 5, [{ row: 2, col: 0, value: "black" }]);
  const h = hint({ rows: 5, cols: 5, rowClues: [[1], [1], [5], [1], [1]], colClues: [[1], [1], [5], [1], [1]], board });
  assert.equal(h.logical, true);
  assert.ok(h.hints.length > 0);
  assert.ok(h.hints.every((c) => !c.guess));
  assert.ok(h.hints.some((c) => c.row === 2 && c.col === 4 && c.value === "black"));
});

test("反算线索: 从完整棋盘还原", () => {
  const { board, rows, cols } = parseBoard("#.#\n###\n...");
  const cl = cluesFromBoard(board, rows, cols);
  assert.deepEqual(cl.rowClues, [[1, 1], [3], []]);
  assert.deepEqual(cl.colClues, [[2], [1], [2]]);
});

test("SQLite: 版本隔离与重启后读取", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nonogram-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  const { puzzleId, versionId } = createPuzzle(db, {
    name: "t", rows: 2, cols: 2, rowClues: [[1], [1]], colClues: [[1], [1]],
  });
  const board = givensToBoard(2, 2, []);
  const r1 = solve({ rows: 2, cols: 2, rowClues: [[1], [1]], colClues: [[1], [1]], board });
  const runId = saveRun(db, versionId, {}, r1);

  const v2 = addGivensVersion(db, puzzleId, [{ row: 0, col: 0, value: "black" }]);
  assert.notEqual(v2, versionId);
  const latest = getLatestVersion(db, puzzleId);
  assert.equal(latest.id, v2);
  const oldV = getVersion(db, versionId);
  assert.deepEqual(oldV.givens, []);
  db.close();

  const db2 = openDb(dbPath);
  const run = getRun(db2, runId);
  assert.equal(run.status, "multiple");
  assert.equal(run.result.solutionsFound, 2);
  db2.close();
});
