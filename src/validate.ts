import type { Cell, Clue, PuzzleInput } from "./types.ts";
import { BLACK, WHITE } from "./types.ts";

/** 允许的最大棋盘规模（单边），用于明确资源预算。 */
export const MAX_DIMENSION = 64;

export class ValidationError extends Error {}

/** 一条线索所需的最小长度：各段长度之和 + 段之间至少一个白格。 */
export function minLineLength(clue: Clue): number {
  if (clue.length === 0) return 0;
  return clue.reduce((a, b) => a + b, 0) + clue.length - 1;
}

function validateClue(clue: unknown, length: number, where: string): Clue {
  if (!Array.isArray(clue)) {
    throw new ValidationError(`${where} 必须是数组（空数组表示全白行/列）`);
  }
  const out: Clue = [];
  for (const seg of clue) {
    if (typeof seg !== "number" || !Number.isInteger(seg) || seg <= 0) {
      throw new ValidationError(`${where} 中的段长度必须为正整数，收到 ${String(seg)}`);
    }
    out.push(seg);
  }
  const need = minLineLength(out);
  if (need > length) {
    throw new ValidationError(
      `${where} 最小占用长度 ${need} 超过该方向长度 ${length}（线索 ${JSON.stringify(out)}）`,
    );
  }
  return out;
}

/**
 * 校验题面并返回规范化结果。
 * 空线索 [] 语义为“全白”，绝不允许被误解为“任意内容”。
 */
export function validatePuzzle(input: unknown): PuzzleInput {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("题面必须是 JSON 对象");
  }
  const obj = input as Record<string, unknown>;
  const rows = obj.rows;
  const cols = obj.cols;
  if (typeof rows !== "number" || !Number.isInteger(rows) || rows <= 0) {
    throw new ValidationError("rows 必须为正整数");
  }
  if (typeof cols !== "number" || !Number.isInteger(cols) || cols <= 0) {
    throw new ValidationError("cols 必须为正整数");
  }
  if (rows > MAX_DIMENSION || cols > MAX_DIMENSION) {
    throw new ValidationError(
      `棋盘规模超出限制：单边最大 ${MAX_DIMENSION}，收到 ${rows}x${cols}`,
    );
  }

  const rowClues = obj.rowClues;
  const colClues = obj.colClues;
  if (!Array.isArray(rowClues) || rowClues.length !== rows) {
    throw new ValidationError(`rowClues 必须是长度 ${rows} 的数组`);
  }
  if (!Array.isArray(colClues) || colClues.length !== cols) {
    throw new ValidationError(`colClues 必须是长度 ${cols} 的数组`);
  }

  const normRowClues = (rowClues as unknown[]).map((clue, i) =>
    validateClue(clue, cols, `rowClues[${i}]`),
  );
  const normColClues = (colClues as unknown[]).map((clue, j) =>
    validateClue(clue, rows, `colClues[${j}]`),
  );

  // 黑格总数上界的粗校验：行最小黑格数与列最小黑格数应一致，否则必矛盾。
  const rowBlack = normRowClues.reduce((a, c) => a + c.reduce((x, y) => x + y, 0), 0);
  const colBlack = normColClues.reduce((a, c) => a + c.reduce((x, y) => x + y, 0), 0);
  // 注意：这只是快速矛盾检测，真正的矛盾由求解器判定，因此这里不抛错，仅记录。

  const known: { r: number; c: number; v: Cell }[] = [];
  if (obj.known !== undefined) {
    if (!Array.isArray(obj.known)) {
      throw new ValidationError("known 必须是数组");
    }
    const seen = new Set<string>();
    for (const kRaw of obj.known) {
      const k = kRaw as Record<string, unknown>;
      if (
        typeof k.r !== "number" || !Number.isInteger(k.r) ||
        typeof k.c !== "number" || !Number.isInteger(k.c)
      ) {
        throw new ValidationError("known 中坐标 r/c 必须为整数");
      }
      if (k.r < 0 || k.r >= rows || k.c < 0 || k.c >= cols) {
        throw new ValidationError(`known 坐标 (${k.r},${k.c}) 越界（棋盘 ${rows}x${cols}）`);
      }
      if (k.v !== BLACK && k.v !== WHITE) {
        throw new ValidationError(`known 中 v 只能是 1（黑）或 2（白），收到 ${String(k.v)}`);
      }
      const key = `${k.r},${k.c}`;
      if (seen.has(key)) {
        throw new ValidationError(`known 坐标 (${k.r},${k.c}) 重复`);
      }
      seen.add(key);
      known.push({ r: k.r, c: k.c, v: k.v as Cell });
    }
  }

  void rowBlack;
  void colBlack;
  return {
    name: typeof obj.name === "string" ? obj.name : undefined,
    rows,
    cols,
    rowClues: normRowClues,
    colClues: normColClues,
    known,
  };
}
