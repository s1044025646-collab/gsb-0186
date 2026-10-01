import { analyzeLine } from "./line.ts";
import type {
  Cell,
  Clue,
  PuzzleInput,
  SolveConfig,
  SolveResult,
  StepRecord,
} from "./types.ts";
import { BLACK, DEFAULT_CONFIG, UNKNOWN, WHITE } from "./types.ts";

export class Board {
  readonly data: Uint8Array;
  readonly rows: number;
  readonly cols: number;
  constructor(
    rows: number,
    cols: number,
  ) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Uint8Array(rows * cols);
  }

  static fromPuzzle(p: PuzzleInput): Board {
    const b = new Board(p.rows, p.cols);
    for (const k of p.known ?? []) b.set(k.r, k.c, k.v);
    return b;
  }

  idx(r: number, c: number): number {
    return r * this.cols + c;
  }
  get(r: number, c: number): Cell {
    return this.data[this.idx(r, c)] as Cell;
  }
  set(r: number, c: number, v: Cell): void {
    this.data[this.idx(r, c)] = v;
  }

  rowLine(r: number): Cell[] {
    const out: Cell[] = new Array<Cell>(this.cols);
    const base = r * this.cols;
    for (let c = 0; c < this.cols; c++) out[c] = this.data[base + c] as Cell;
    return out;
  }
  colLine(c: number): Cell[] {
    const out: Cell[] = new Array<Cell>(this.rows);
    for (let r = 0; r < this.rows; r++) out[r] = this.data[r * this.cols + c] as Cell;
    return out;
  }

  clone(): Board {
    const b = new Board(this.rows, this.cols);
    b.data.set(this.data);
    return b;
  }

  isComplete(): boolean {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] === UNKNOWN) return false;
    }
    return true;
  }

  unknownCount(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === UNKNOWN) n++;
    return n;
  }

  toGrid(): Cell[][] {
    const g: Cell[][] = [];
    for (let r = 0; r < this.rows; r++) g.push(this.rowLine(r));
    return g;
  }
}

interface PropagationResult {
  feasible: boolean;
  /** 每条线最近一次分析的摆放总数，用于 MRV 启发式选格。 */
  lineTotals: { orientation: "row" | "col"; index: number; total: number }[];
}

interface SolverContext {
  rowClues: Clue[];
  colClues: Clue[];
  config: SolveConfig;
  steps: StepRecord[];
  nodesVisited: number;
  deadline: number;
  budgetExhausted: boolean;
  /** 当前是否正处于“做出一个假设”的动作中；只有该动作本身被标记为非逻辑。 */
  guessing: boolean;
}

function describeClue(clue: Clue): string {
  return clue.length === 0 ? "∅（全白）" : clue.join(",");
}

/**
 * 行列候选传播：反复对每行/每列做线性求解并应用必然格，直到无变化或矛盾。
 * depth 为当前回溯深度；仅 depth=0 的强制格可作为纯逻辑提示。
 */
function propagate(
  board: Board,
  ctx: SolverContext,
  depth: number,
  record: boolean,
): PropagationResult {
  const dirtyRows = new Set<number>();
  const dirtyCols = new Set<number>();
  for (let r = 0; r < board.rows; r++) dirtyRows.add(r);
  for (let c = 0; c < board.cols; c++) dirtyCols.add(c);

  const rowTotals = new Array<number>(board.rows).fill(0);
  const colTotals = new Array<number>(board.cols).fill(0);
  let seq = ctx.steps.length;

  while (dirtyRows.size > 0 || dirtyCols.size > 0) {
    const touchedCols = new Set<number>();
    const touchedRows = new Set<number>();

    for (const r of dirtyRows) {
      dirtyRows.delete(r);
      const line = board.rowLine(r);
      const a = analyzeLine(ctx.rowClues[r]!, line);
      rowTotals[r] = a.total;
      if (!a.feasible) return { feasible: false, lineTotals: [] };
      if (a.forced.length > 0) {
        const cells = a.forced.map((f) => ({ r, c: f.pos, v: f.v }));
        for (const f of a.forced) {
          board.set(r, f.pos, f.v);
          touchedCols.add(f.pos);
        }
        if (record) {
          const reason = buildReason("row", r, ctx.rowClues[r]!, a);
          ctx.steps.push({
            seq: seq++,
            logical: !ctx.guessing,
            orientation: "row",
            index: r,
            cells,
            reason,
          });
        }
      }
    }

    for (const c of dirtyCols) {
      dirtyCols.delete(c);
      const line = board.colLine(c);
      const a = analyzeLine(ctx.colClues[c]!, line);
      colTotals[c] = a.total;
      if (!a.feasible) return { feasible: false, lineTotals: [] };
      if (a.forced.length > 0) {
        const cells = a.forced.map((f) => ({ r: f.pos, c, v: f.v }));
        for (const f of a.forced) {
          board.set(f.pos, c, f.v);
          touchedRows.add(f.pos);
        }
        if (record) {
          const reason = buildReason("col", c, ctx.colClues[c]!, a);
          ctx.steps.push({
            seq: seq++,
            logical: !ctx.guessing,
            orientation: "col",
            index: c,
            cells,
            reason,
          });
        }
      }
    }

    for (const c of touchedCols) {
      dirtyCols.add(c);
      // 列变化也可能让行重算；行在下一轮统一由 touchedRows 标记
    }
    for (const r of touchedRows) dirtyRows.add(r);
  }

  const lineTotals: PropagationResult["lineTotals"] = [];
  for (let r = 0; r < board.rows; r++) {
    if (board.rowLine(r).includes(UNKNOWN)) {
      lineTotals.push({ orientation: "row", index: r, total: rowTotals[r] ?? 1 });
    }
  }
  for (let c = 0; c < board.cols; c++) {
    if (board.colLine(c).includes(UNKNOWN)) {
      lineTotals.push({ orientation: "col", index: c, total: colTotals[c] ?? 1 });
    }
  }
  return { feasible: true, lineTotals };
}

function buildReason(
  orientation: "row" | "col",
  index: number,
  clue: Clue,
  a: ReturnType<typeof analyzeLine>,
): string {
  const label = orientation === "row" ? `第 ${index + 1} 行` : `第 ${index + 1} 列`;
  const blacks = a.forced.filter((f) => f.v === BLACK).map((f) => (orientation === "row" ? f.pos + 1 : f.pos + 1));
  const whites = a.forced.filter((f) => f.v === WHITE).map((f) => (orientation === "row" ? f.pos + 1 : f.pos + 1));
  const parts: string[] = [];
  parts.push(
    `${label}线索 [${describeClue(clue)}] 在当前已知格下共有 ${a.total >= 1_000_000_000 ? "≥10亿" : a.total} 种候选摆放`,
  );
  if (blacks.length > 0) {
    parts.push(`位置 ${blacks.join("、")} 在所有候选中均为黑（为白的候选被排除 0 种存活）`);
  }
  if (whites.length > 0) {
    parts.push(`位置 ${whites.join("、")} 在所有候选中均为白（任何黑段都无法覆盖）`);
  }
  return parts.join("；");
}

/** MRV 选格：找候选摆放数最少的线上的第一个未知格。 */
function pickCell(board: Board, info: PropagationResult): { r: number; c: number } | null {
  if (info.lineTotals.length === 0) return null;
  let best = info.lineTotals[0]!;
  for (const t of info.lineTotals) if (t.total < best.total) best = t;
  if (best.orientation === "row") {
    const r = best.index;
    for (let c = 0; c < board.cols; c++) if (board.get(r, c) === UNKNOWN) return { r, c };
  } else {
    const c = best.index;
    for (let r = 0; r < board.rows; r++) if (board.get(r, c) === UNKNOWN) return { r, c };
  }
  return null;
}

function dfs(
  board: Board,
  ctx: SolverContext,
  depth: number,
  witnesses: Board[],
): void {
  if (witnesses.length >= 2) return;
  ctx.nodesVisited++;
  if (ctx.nodesVisited > ctx.config.maxNodes || Date.now() > ctx.deadline) {
    ctx.budgetExhausted = true;
    return;
  }

  const info = propagate(board, ctx, depth, ctx.config.recordSteps);
  if (!info.feasible) return;

  if (board.isComplete()) {
    witnesses.push(board.clone());
    return;
  }

  const cell = pickCell(board, info);
  if (!cell) return;

  for (const guess of [BLACK, WHITE] as Cell[]) {
    if (witnesses.length >= 2) return;
    const child = board.clone();
    if (ctx.config.recordSteps) {
      // 只有“主动假设”这一步标记为非逻辑；其后由线索必然推出的格子仍是逻辑步。
      ctx.guessing = true;
      ctx.steps.push({
        seq: ctx.steps.length,
        logical: false,
        orientation: "row",
        index: cell.r,
        cells: [{ r: cell.r, c: cell.c, v: guess }],
        reason: `回溯猜测：在 (${cell.r + 1},${cell.c + 1}) 假设为${guess === BLACK ? "黑" : "白"}（非必然结论，仅用于搜索分支）`,
      });
      child.set(cell.r, cell.c, guess);
      ctx.guessing = false;
    } else {
      child.set(cell.r, cell.c, guess);
    }
    dfs(child, ctx, depth + 1, witnesses);
    if (ctx.budgetExhausted) return;
  }
}

/** 仅做根级逻辑传播，用于“下一步提示”；不进行任何猜测。 */
export function logicalHint(puzzle: PuzzleInput): {
  feasible: boolean;
  complete: boolean;
  steps: StepRecord[];
  board: Board;
} {
  const board = Board.fromPuzzle(puzzle);
  const ctx: SolverContext = {
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
    config: { ...DEFAULT_CONFIG, recordSteps: true },
    steps: [],
    nodesVisited: 0,
    deadline: Date.now() + DEFAULT_CONFIG.maxTimeMs,
    budgetExhausted: false,
    guessing: false,
  };
  const info = propagate(board, ctx, 0, true);
  return { feasible: info.feasible, complete: board.isComplete(), steps: ctx.steps, board };
}

export function solve(puzzle: PuzzleInput, configOverrides?: Partial<SolveConfig>): SolveResult {
  const config: SolveConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const start = Date.now();
  const ctx: SolverContext = {
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
    config,
    steps: [],
    nodesVisited: 0,
    deadline: start + config.maxTimeMs,
    budgetExhausted: false,
    guessing: false,
  };
  const witnesses: Board[] = [];
  const root = Board.fromPuzzle(puzzle);
  dfs(root, ctx, 0, witnesses);
  const elapsedMs = Date.now() - start;

  const found = witnesses.length;
  let outcome: SolveResult["outcome"];
  let boundary: string | null = null;
  if (found >= 2) {
    outcome = "multiple";
  } else if (ctx.budgetExhausted) {
    outcome = "budget_exhausted";
    boundary =
      `已访问 ${ctx.nodesVisited} 个搜索节点（上限 ${config.maxNodes}），耗时 ${elapsedMs}ms（上限 ${config.maxTimeMs}ms）；` +
      `已确认 ${found} 个解${found === 0 ? "，但搜索未完成，不能判定无解；可能仍存在解" : "，可能还存在更多不同解"}。`;
  } else if (found === 0) {
    outcome = "unsatisfiable";
  } else {
    outcome = "unique";
  }

  return {
    outcome,
    rows: puzzle.rows,
    cols: puzzle.cols,
    witnesses: witnesses.slice(0, 2).map((b) => b.toGrid()),
    solutionCount: found,
    nodesVisited: ctx.nodesVisited,
    elapsedMs,
    budgetExhausted: ctx.budgetExhausted,
    boundary,
    steps: ctx.steps,
  };
}
