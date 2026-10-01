import type { Cell, Clue } from "./types.ts";
import { BLACK, UNKNOWN, WHITE } from "./types.ts";

/** 把字符/数字棋盘渲染成终端字符画：█ 黑、· 白、? 未知。 */
export function renderGrid(grid: readonly (readonly Cell[])[]): string {
  return grid
    .map((row) =>
      row
        .map((c) => (c === BLACK ? "█" : c === WHITE ? "·" : "?"))
        .join(" "),
    )
    .join("\n");
}

/** 从一行 0/1/2 的格子反算黑段线索；含未知格时抛错（要求完整棋盘）。 */
export function clueFromLine(line: readonly Cell[]): Clue {
  const clue: Clue = [];
  let run = 0;
  for (const c of line) {
    if (c === UNKNOWN) {
      throw new Error("无法从含未知格的棋盘反算线索");
    }
    if (c === BLACK) {
      run++;
    } else if (run > 0) {
      clue.push(run);
      run = 0;
    }
  }
  if (run > 0) clue.push(run);
  return clue;
}

/** 从完整黑白棋盘反算全部行/列线索。 */
export function cluesFromGrid(grid: Cell[][]): {
  rows: number;
  cols: number;
  rowClues: Clue[];
  colClues: Clue[];
} {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0]!.length : 0;
  if (!grid.every((r) => r.length === cols)) {
    throw new Error("棋盘行列不齐，无法反算线索");
  }
  const rowClues = grid.map((r) => clueFromLine(r));
  const colClues: Clue[] = [];
  for (let c = 0; c < cols; c++) {
    const col: Cell[] = [];
    for (let r = 0; r < rows; r++) col.push(grid[r]![c]!);
    colClues.push(clueFromLine(col));
  }
  return { rows, cols, rowClues, colClues };
}

/** 校验一份“完整解”是否严格满足给定线索。 */
export function gridSatisfies(
  grid: readonly (readonly Cell[])[],
  rowClues: Clue[],
  colClues: Clue[],
): boolean {
  const { rowClues: rc, colClues: cc } = cluesFromGrid(grid as Cell[][]);
  const eq = (a: Clue[], b: Clue[]) =>
    a.length === b.length && a.every((x, i) => x.length === b[i]!.length && x.every((v, j) => v === b[i]![j]));
  return eq(rc, rowClues) && eq(cc, colClues);
}

/** 紧凑字符串（█/·），便于导出与终端展示。 */
export function gridToStrings(grid: readonly (readonly Cell[])[]): string[] {
  return grid.map((row) =>
    row.map((c) => (c === BLACK ? "█" : c === WHITE ? "·" : "?")).join(""),
  );
}

/** 从 █/■/#/1（黑）与 ·/空格/0（白）的字符串数组解析棋盘。 */
export function parseRows(rows: string[]): Cell[][] {
  return rows.map((line) =>
    [...line].map((ch): Cell => {
      if (ch === "█" || ch === "■" || ch === "#" || ch === "1") return BLACK;
      if (ch === "·" || ch === "." || ch === " " || ch === "0" || ch === "x" || ch === "X") return WHITE;
      return UNKNOWN;
    }),
  );
}
