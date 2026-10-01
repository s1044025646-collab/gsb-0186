/** 单元格状态 */
export const UNKNOWN = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Cell = 0 | 1 | 2;

export type Clues = number[]; // 空数组表示“整行/列无黑格”

export interface Given {
  row: number;
  col: number;
  value: "black" | "white";
}

export interface PuzzleInput {
  name?: string;
  rows: number;
  cols: number;
  rowClues: Clues[];
  colClues: Clues[];
  givens?: Given[];
}

export interface SolveConfig {
  maxNodes?: number;      // 搜索节点预算, 默认 200000
  maxTimeMs?: number;     // 时间预算, 默认 10000
  maxSolutions?: number;  // 需要收集的解数量上限, 默认 2 (用于唯一性判定)
  maxCandidatesPerLine?: number; // 单行候选数上限, 默认 200000
}

export type SolveStatus = "unsat" | "unique" | "multiple" | "budget_exceeded";

export interface StepEntry {
  seq: number;
  kind: "propagate" | "guess";
  lineType?: "row" | "col";
  lineIndex?: number;
  derivedBlack: Array<[number, number]>;
  derivedWhite: Array<[number, number]>;
  candidatesBefore?: number;
  candidatesAfter?: number;
  reason: string;
}

export interface SolveResult {
  status: SolveStatus;
  /** 已发现的解(最多 maxSolutions 个), 字符棋盘形式 */
  solutions: string[];
  /** 已发现解的数量(可能因预算被截断) */
  solutionsFound: number;
  nodes: number;
  elapsedMs: number;
  steps: StepEntry[];
  /** 结论边界说明, 例如预算耗尽时“至少 N 个解, 唯一性未判定” */
  bound: string;
}

export interface HintCell {
  row: number;
  col: number;
  value: "black" | "white";
  reason: string;
  lineType: "row" | "col";
  lineIndex: number;
  guess: boolean;
}

export interface HintResult {
  hints: HintCell[];
  logical: boolean; // 是否纯逻辑推出(无猜测)
  note: string;
  steps: StepEntry[];
}
