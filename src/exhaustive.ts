import { BLACK, WHITE, Clues } from "./types";
import { cluesFromBoard } from "./puzzle";

/**
 * 独立测试基准: 对小棋盘穷举所有 2^(r*c) 填法,
 * 统计满足行列线索的解数量。用于交叉验证求解器的无解/唯一性判断。
 */
export function exhaustiveCount(rows: number, cols: number, rowClues: Clues[], colClues: Clues[]): { count: number; examples: string[] } {
  const total = rows * cols;
  if (total > 25) throw new Error("穷举基准仅支持总格数 <= 25 的棋盘");
  let count = 0;
  const examples: string[] = [];
  const limit = 1 << total;
  const board = new Uint8Array(total);
  for (let mask = 0; mask < limit; mask++) {
    for (let i = 0; i < total; i++) board[i] = (mask >> i) & 1 ? BLACK : WHITE;
    const cl = cluesFromBoard(board, rows, cols);
    if (JSON.stringify(cl.rowClues) === JSON.stringify(rowClues) &&
        JSON.stringify(cl.colClues) === JSON.stringify(colClues)) {
      count++;
      if (examples.length < 2) {
        const lines: string[] = [];
        for (let r = 0; r < rows; r++) {
          let s = "";
          for (let c = 0; c < cols; c++) s += board[r * cols + c] === BLACK ? "#" : ".";
          lines.push(s);
        }
        examples.push(lines.join("\n"));
      }
    }
  }
  return { count, examples };
}
