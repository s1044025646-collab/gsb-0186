import { BLACK, WHITE, UNKNOWN, Cell, Clues, Given, PuzzleInput } from "./types";

export const MAX_ROWS = 64;
export const MAX_COLS = 64;

export class ValidationError extends Error {}

function checkClue(clue: unknown, where: string, lineLen: number): Clues {
  if (!Array.isArray(clue)) {
    throw new ValidationError(`${where}: 线索必须是数组(空数组 [] 表示无黑格), 收到 ${JSON.stringify(clue)}`);
  }
  for (const v of clue) {
    if (!Number.isInteger(v) || (v as number) <= 0) {
      throw new ValidationError(`${where}: 段长度必须是正整数, 收到 ${JSON.stringify(v)}`);
    }
  }
  const c = clue as Clues;
  const minLen = c.reduce((a, b) => a + b, 0) + Math.max(0, c.length - 1);
  if (minLen > lineLen) {
    throw new ValidationError(`${where}: 线索最小占用长度 ${minLen} 超过线长 ${lineLen}`);
  }
  return c;
}

export function validatePuzzleInput(input: PuzzleInput): Required<PuzzleInput> {
  const { rows, cols } = input;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new ValidationError("rows/cols 必须是正整数");
  }
  if (rows > MAX_ROWS || cols > MAX_COLS) {
    throw new ValidationError(`棋盘规模超限: 最大 ${MAX_ROWS}x${MAX_COLS}, 收到 ${rows}x${cols}`);
  }
  if (!Array.isArray(input.rowClues) || input.rowClues.length !== rows) {
    throw new ValidationError(`rowClues 必须是长度 ${rows} 的数组`);
  }
  if (!Array.isArray(input.colClues) || input.colClues.length !== cols) {
    throw new ValidationError(`colClues 必须是长度 ${cols} 的数组`);
  }
  const rowClues = input.rowClues.map((c, i) => checkClue(c, `rowClues[${i}]`, cols));
  const colClues = input.colClues.map((c, i) => checkClue(c, `colClues[${i}]`, rows));
  const givens: Given[] = [];
  for (const g of input.givens ?? []) {
    if (!Number.isInteger(g.row) || !Number.isInteger(g.col) ||
        g.row < 0 || g.row >= rows || g.col < 0 || g.col >= cols) {
      throw new ValidationError(`已知格坐标越界: (${g?.row}, ${g?.col})`);
    }
    if (g.value !== "black" && g.value !== "white") {
      throw new ValidationError(`已知格取值必须是 "black" 或 "white": (${g.row}, ${g.col})`);
    }
    givens.push({ row: g.row, col: g.col, value: g.value });
  }
  return { name: input.name ?? "untitled", rows, cols, rowClues, colClues, givens };
}

export function givensToBoard(rows: number, cols: number, givens: Given[]): Uint8Array {
  const board = new Uint8Array(rows * cols).fill(UNKNOWN);
  for (const g of givens) board[g.row * cols + g.col] = g.value === "black" ? BLACK : WHITE;
  return board;
}

export function renderBoard(board: Uint8Array, rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let s = "";
    for (let c = 0; c < cols; c++) {
      const v = board[r * cols + c];
      s += v === BLACK ? "#" : v === WHITE ? "." : "?";
    }
    lines.push(s);
  }
  return lines.join("\n");
}

export function parseBoard(text: string): { board: Uint8Array; rows: number; cols: number } {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new ValidationError("棋盘文本为空");
  const cols = lines[0].length;
  const rows = lines.length;
  if (rows > MAX_ROWS || cols > MAX_COLS) throw new ValidationError(`棋盘规模超限: 最大 ${MAX_ROWS}x${MAX_COLS}`);
  const board = new Uint8Array(rows * cols);
  lines.forEach((line, r) => {
    if (line.length !== cols) throw new ValidationError(`第 ${r} 行长度不一致`);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      if (ch === "#" || ch === "X" || ch === "1") board[r * cols + c] = BLACK;
      else if (ch === "." || ch === "0" || ch === "_") board[r * cols + c] = WHITE;
      else if (ch === "?") board[r * cols + c] = UNKNOWN;
      else throw new ValidationError(`非法字符 '${ch}' at (${r},${c})`);
    }
  });
  return { board, rows, cols };
}

/** 从完整棋盘反算行列线索 */
export function cluesFromBoard(board: Uint8Array, rows: number, cols: number): { rowClues: Clues[]; colClues: Clues[] } {
  const lineClues = (get: (i: number) => number, len: number): Clues => {
    const res: Clues = [];
    let run = 0;
    for (let i = 0; i < len; i++) {
      if (get(i) === BLACK) run++;
      else if (run > 0) { res.push(run); run = 0; }
    }
    if (run > 0) res.push(run);
    return res;
  };
  const rowClues: Clues[] = [];
  for (let r = 0; r < rows; r++) rowClues.push(lineClues((c) => board[r * cols + c], cols));
  const colClues: Clues[] = [];
  for (let c = 0; c < cols; c++) colClues.push(lineClues((r) => board[r * cols + c], rows));
  return { rowClues, colClues };
}
