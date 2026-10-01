import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGrid } from "../src/grid.ts";
import { solve } from "../src/solver.ts";
import { SAMPLES } from "../src/samples.ts";
import { BLACK, WHITE, type Cell, type PuzzleInput } from "../src/types.ts";
import { cluesFromGrid, gridSatisfies } from "../src/grid.ts";
import { validatePuzzle, ValidationError } from "../src/validate.ts";

/** 对小棋盘（固定行列数）穷举所有 2^(r*c) 图案，返回满足线索的完整解数（最多数到 3）。 */
function bruteForceCount(p: PuzzleInput, cap = 3): number {
  const total = p.rows * p.cols;
  let count = 0;
  for (let mask = 0; mask < 1 << total; mask++) {
    const grid: Cell[][] = [];
    for (let r = 0; r < p.rows; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < p.cols; c++) {
        const bit = (mask >> (r * p.cols + c)) & 1;
        row.push(bit === 1 ? BLACK : WHITE);
      }
      grid.push(row);
    }
    // 已知格必须一致
    if (p.known) {
      let knownOk = true;
      for (const k of p.known) {
        if (grid[k.r]![k.c] !== k.v) {
          knownOk = false;
          break;
        }
      }
      if (!knownOk) continue;
    }
    if (gridSatisfies(grid, p.rowClues, p.colClues)) {
      count++;
      if (count >= cap) return count;
    }
  }
  return count;
}

/** 随机生成若干小尺寸题面，比较求解器的无解/唯一/多解判定与穷举基准。 */
function randomPuzzle(rng: () => number, rows: number, cols: number): PuzzleInput {
  const grid: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) row.push(rng() < 0.45 ? BLACK : WHITE);
    grid.push(row);
  }
  const { rowClues, colClues } = cluesFromGrid(grid);
  return { rows, cols, rowClues, colClues };
}

test("小棋盘穷举基准：求解器结论与暴力枚举一致", () => {
  let seed = 1234567;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 60; iter++) {
    const rows = 1 + Math.floor(rng() * 4);
    const cols = 1 + Math.floor(rng() * 4);
    const p = randomPuzzle(rng, rows, cols);
    const bf = bruteForceCount(p);
    const res = solve(p);
    const expected = bf === 0 ? "unsatisfiable" : bf === 1 ? "unique" : "multiple";
    assert.equal(res.outcome, expected, `题面 ${JSON.stringify(p)} 期望 ${expected} 得 ${res.outcome}`);
    if (expected === "unique") {
      assert.equal(res.witnesses.length, 1);
      assert.ok(gridSatisfies(res.witnesses[0]!, p.rowClues, p.colClues));
    }
    if (expected === "multiple") assert.equal(res.witnesses.length, 2);
  }
});

test("空白棋盘（所有线索为空）唯一解为全白", () => {
  const p = validatePuzzle({
    rows: 3,
    cols: 3,
    rowClues: [[], [], []],
    colClues: [[], [], []],
  });
  const res = solve(p);
  assert.equal(res.outcome, "unique");
  assert.ok(res.witnesses[0]!.every((row) => row.every((c) => c === WHITE)));
});

test("空线索不能被当作任意内容：空列与全黑行矛盾", () => {
  const res = solve(validatePuzzle(SAMPLES.contradiction));
  assert.equal(res.outcome, "unsatisfiable");
});

test("线索刚好填满整行", () => {
  const p = validatePuzzle({
    rows: 3,
    cols: 3,
    rowClues: [[3], [], []],
    colClues: [[1], [1], [1]],
  });
  const res = solve(p);
 assert.equal(res.outcome, "unique");
});

test("黑段之间最小白格：最小占用长度超过线长被判非法", () => {
  assert.throws(
    () =>
      validatePuzzle({
        rows: 1,
        cols: 3,
        rowClues: [[2, 2]],
        colClues: [[1], [1], [1]],
      }),
    ValidationError,
  );
});

test("已知格冲突判无解", () => {
  const res = solve(validatePuzzle(SAMPLES.knownConflict));
  assert.equal(res.outcome, "unsatisfiable");
});

test("多解返回两份不同且都满足线索的见证", () => {
  const res = solve(validatePuzzle(SAMPLES.multiple));
  assert.equal(res.outcome, "multiple");
  assert.equal(res.witnesses.length, 2);
  assert.notDeepEqual(res.witnesses[0], res.witnesses[1]);
  for (const w of res.witnesses) {
    assert.ok(gridSatisfies(w, SAMPLES.multiple.rowClues, SAMPLES.multiple.colClues));
  }
});

test("极小预算 => budget_exhausted，绝不误判无解，并保存边界", () => {
  const p = validatePuzzle({
    rows: 8,
    cols: 8,
    rowClues: Array(8).fill([1]),
    colClues: Array(8).fill([1]),
  });
  const res = solve(p, { maxNodes: 3, maxTimeMs: 60_000 });
  assert.equal(res.outcome, "budget_exhausted");
  assert.equal(res.budgetExhausted, true);
  assert.ok(res.boundary);
  assert.match(res.boundary!, /不能判定无解|可能/);
});

test("唯一性：找到一个解不能直接称为唯一（多解样例不被误判）", () => {
  // 3 皇后风格：每行每列一个黑，3x3 有 6 个解
  const p = validatePuzzle({
    rows: 3,
    cols: 3,
    rowClues: [[1], [1], [1]],
    colClues: [[1], [1], [1]],
  });
  const res = solve(p);
  assert.equal(res.outcome, "multiple");
  assert.equal(bruteForceCount(p), 3); // cap=3，代表 >=3
});

test("非方形与对称内置样例均可解且唯一", () => {
  for (const key of ["symmetric", "nonsquare"] as const) {
    const res = solve(validatePuzzle(SAMPLES[key]));
    assert.equal(res.outcome, "unique", key);
  }
});

test("渲染输出为字符棋盘", () => {
  const res = solve(validatePuzzle(SAMPLES.symmetric));
  const text = renderGrid(res.witnesses[0]!);
  assert.match(text, /█/);
  assert.match(text, /·/);
});
