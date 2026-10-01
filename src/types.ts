/**
 * 核心数据类型定义。
 *
 * 格子状态：
 *   - 0 未知
 *   - 1 黑格
 *   - 2 白格（确定非黑）
 */
export const UNKNOWN = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Cell = 0 | 1 | 2;

/** 单条线索：连续黑格段长度的有序列表；空数组表示整行/整列必须全白。 */
export type Clue = number[];

export interface PuzzleInput {
  name?: string;
  /** 行数（高） */
  rows: number;
  /** 列数（宽） */
  cols: number;
  /** 每行一条线索，长度必须等于 rows。 */
  rowClues: Clue[];
  /** 每列一条线索，长度必须等于 cols。 */
  colClues: Clue[];
  /**
   * 已知格（可选）。值为 1 表示已知黑，2 表示已知白（含叉号）。
   * 坐标 r/c 从 0 开始。
   */
  known?: { r: number; c: number; v: Cell }[];
}

export interface SolveConfig {
  /** 搜索过程中允许访问的最大搜索节点数（含根节点）。 */
  maxNodes: number;
  /** 搜索过程中允许的最长墙钟时间（毫秒）。 */
  maxTimeMs: number;
  /** 是否生成逐步推理记录（逻辑提示用）。 */
  recordSteps: boolean;
}

export const DEFAULT_CONFIG: SolveConfig = {
  maxNodes: 200_000,
  maxTimeMs: 10_000,
  recordSteps: true,
};

export type SolveOutcome =
  | "unsatisfiable"
  | "unique"
  | "multiple"
  | "budget_exhausted";

export interface StepRecord {
  /** 该步骤序号（从 0 开始）。 */
  seq: number;
  /** true 表示该行/列的求解完全由线索与已知格必然推出；false 表示依赖回溯猜测。 */
  logical: boolean;
  /** "row" 或 "col"。 */
  orientation: "row" | "col";
  /** 行号或列号（0 基）。 */
  index: number;
  /** 本步确定的格子（在整盘上的坐标）与确定值。 */
  cells: { r: number; c: number; v: Cell }[];
  /**
   * 人类可读的排除原因（中文）。
   * 关联具体行列以及候选排除计数，完全基于当时已知状态，而非事后用最终解伪造。
   */
  reason: string;
}

export interface SolveResult {
  outcome: SolveOutcome;
  rows: number;
  cols: number;
  /** 已发现的不同解（0、1 或 2 个；multiple 时恰好两个）。 */
  witnesses: Cell[][][];
  /** 已确认存在的不同解数量下界。 */
  solutionCount: number;
  /** 实际访问的搜索节点数。 */
  nodesVisited: number;
  /** 实际耗时（毫秒）。 */
  elapsedMs: number;
  /** 预算是否被消耗完（节点或时间）。 */
  budgetExhausted: boolean;
  /** 达到预算时的结论边界说明（未超预算为 null）。 */
  boundary: string | null;
  steps: StepRecord[];
}
