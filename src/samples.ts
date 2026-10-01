import { BLACK, WHITE, type PuzzleInput } from "./types.ts";

/** 5x5 上下对称图案（唯一解，经搜索验证）。 */
export const symmetric: PuzzleInput = {
  name: "symmetric-5x5",
  rows: 5,
  cols: 5,
  rowClues: [[1, 1], [2, 1], [1], [2, 1], [1]],
  colClues: [[2, 1], [1, 1], [1, 1, 1], [], [1, 1]],
};

/** 非方形 4x6 棋盘（4 行 6 列），唯一解。 */
export const nonsquare: PuzzleInput = {
  name: "nonsquare-4x6",
  rows: 4,
  cols: 6,
  rowClues: [[2, 2], [1, 1], [1, 2, 1], [2, 2]],
  colClues: [[4], [1, 1], [1], [1], [1, 1], [4]],
};

/** 明确矛盾：行要求全黑长度 3，列却要求空（全白）。 */
export const contradiction: PuzzleInput = {
  name: "contradiction-3x3",
  rows: 3,
  cols: 3,
  rowClues: [[3], [3], [3]],
  colClues: [[], [], []],
};

/** 多解题：2x2 无任何线索约束（线索全空表示全白其实是唯一全白；
 * 这里用“每行每列恰好一个黑格”得到两个对角线解）。 */
export const multiple: PuzzleInput = {
  name: "multiple-2x2",
  rows: 2,
  cols: 2,
  rowClues: [[1], [1]],
  colClues: [[1], [1]],
};

/** 一份“部分完成”的 5x5 题面，用于演示提示：给出几个已知黑白格。 */
export const partialSymmetric: PuzzleInput = {
  name: "partial-symmetric-5x5",
  rows: 5,
  cols: 5,
  rowClues: [[1, 1], [2, 1], [1], [2, 1], [1]],
  colClues: [[2, 1], [1, 1], [1, 1, 1], [], [1, 1]],
  known: [
    { r: 0, c: 0, v: BLACK },
    { r: 1, c: 0, v: BLACK },
    { r: 1, c: 1, v: BLACK },
    { r: 2, c: 2, v: BLACK },
  ],
};

/** 已知格直接冲突的题面（同一格被黑段要求但已知为白）。 */
export const knownConflict: PuzzleInput = {
  name: "known-conflict-3x3",
  rows: 3,
  cols: 3,
  rowClues: [[3], [1], [1]],
  colClues: [[1, 1], [1], [1]],
  known: [{ r: 0, c: 0, v: WHITE }],
};

export const SAMPLES = {
  symmetric,
  nonsquare,
  contradiction,
  multiple,
  partial: partialSymmetric,
  knownConflict,
} satisfies Record<string, PuzzleInput>;

export type SampleName = keyof typeof SAMPLES;
