import { DatabaseSync } from "node:sqlite";
import { createPuzzle } from "./db";

/** 内置示例谜题 */
export function seedAll(db: DatabaseSync): Array<{ key: string; puzzleId: number; versionId: number }> {
  const out: Array<{ key: string; puzzleId: number; versionId: number }> = [];
  const add = (key: string, input: Parameters<typeof createPuzzle>[1]) => {
    const { puzzleId, versionId } = createPuzzle(db, input);
    out.push({ key, puzzleId, versionId });
  };

  // 1. 对称图案(5x5, X 形, 唯一解)
  add("symmetric-x", {
    name: "对称X(5x5)",
    rows: 5, cols: 5,
    rowClues: [[1, 1], [1, 1], [1], [1, 1], [1, 1]],
    colClues: [[1, 1], [1, 1], [1], [1, 1], [1, 1]],
  });

  // 2. 非方形棋盘(3x6)
  add("rect-3x6", {
    name: "非方形(3x6)",
    rows: 3, cols: 6,
    rowClues: [[6], [2, 2], []],
    colClues: [[1], [2], [1], [1], [2], [1]],
  });

  // 3. 明确矛盾(行要求黑格, 已知格为白且占满)
  add("contradiction", {
    name: "矛盾(2x2)",
    rows: 2, cols: 2,
    rowClues: [[2], [2]],
    colClues: [[2], [2]],
    givens: [{ row: 0, col: 0, value: "white" }],
  });

  // 4. 多解题(2x2 对角两种填法)
  add("multiple", {
    name: "多解(2x2)",
    rows: 2, cols: 2,
    rowClues: [[1], [1]],
    colClues: [[1], [1]],
  });

  // 5. 部分完成的题面(用于提示演示): 5x5 十字
  add("partial-cross", {
    name: "部分完成十字(5x5)",
    rows: 5, cols: 5,
    rowClues: [[1], [1], [5], [1], [1]],
    colClues: [[1], [1], [5], [1], [1]],
    givens: [
      { row: 2, col: 0, value: "black" },
      { row: 0, col: 2, value: "black" },
    ],
  });

  return out;
}
