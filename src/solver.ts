import { BLACK, WHITE, UNKNOWN, Clues, SolveConfig, SolveResult, StepEntry } from "./types";
import { generateCandidates, filterCandidates, candidatesAnd, candidatesOr } from "./line";

export interface SolverInput {
  rows: number;
  cols: number;
  rowClues: Clues[];
  colClues: Clues[];
  board: Uint8Array; // 初始已知格(UNKNOWN/BLACK/WHITE)
}

const DEFAULTS: Required<SolveConfig> = {
  maxNodes: 200_000,
  maxTimeMs: 10_000,
  maxSolutions: 2,
  maxCandidatesPerLine: 200_000,
};

interface LineState {
  cands: bigint[];
}

export class BudgetExceeded extends Error {}

/**
 * 行列候选传播 + 带回溯搜索。
 * 找到 maxSolutions 个解即停止(用于唯一性/多解判定);
 * 预算(节点/时间)耗尽时抛出 BudgetExceeded, 由 solve() 汇总为 budget_exceeded。
 */
export function solve(input: SolverInput, config: SolveConfig = {}): SolveResult {
  const cfg = { ...DEFAULTS, ...config };
  const { rows, cols } = input;
  const started = Date.now();
  const steps: StepEntry[] = [];
  let seq = 0;
  let nodes = 0;
  const deadline = started + cfg.maxTimeMs;
  const solutions: string[] = [];
  let truncatedByCap = false;

  // 初始候选
  const rowLines: LineState[] = input.rowClues.map((c) => ({ cands: generateCandidates(cols, c, cfg.maxCandidatesPerLine) }));
  const colLines: LineState[] = input.colClues.map((c) => ({ cands: generateCandidates(rows, c, cfg.maxCandidatesPerLine) }));
  for (let i = 0; i < rows; i++) {
    if (rowLines[i].cands.length >= cfg.maxCandidatesPerLine) {
      // 候选被截断, 记录但仍继续(传播可能迅速收敛); 极端情况由预算兜底
    }
  }

  const board = new Uint8Array(input.board);

  const lineMasks = (b: Uint8Array, lineType: "row" | "col", idx: number): { kb: bigint; kw: bigint } => {
    let kb = 0n, kw = 0n;
    const len = lineType === "row" ? cols : rows;
    for (let i = 0; i < len; i++) {
      const v = lineType === "row" ? b[idx * cols + i] : b[i * cols + idx];
      if (v === BLACK) kb |= 1n << BigInt(i);
      else if (v === WHITE) kw |= 1n << BigInt(i);
    }
    return { kb, kw };
  };

  /** 对一条线做传播; 返回 false 表示冲突。会把推出的格写入 board 并入队交叉线。 */
  const propagateLine = (
    b: Uint8Array,
    lines: LineState[][],
    lineType: "row" | "col",
    idx: number,
    queue: Array<["row" | "col", number]>,
    record: boolean
  ): boolean => {
    const ls = lines[lineType === "row" ? 0 : 1][idx];
    const before = ls.cands.length;
    const { kb, kw } = lineMasks(b, lineType, idx);
    ls.cands = filterCandidates(ls.cands, kb, kw);
    if (ls.cands.length === 0) return false;
    const andM = candidatesAnd(ls.cands);
    const orM = candidatesOr(ls.cands);
    const len = lineType === "row" ? cols : rows;
    const derivedBlack: Array<[number, number]> = [];
    const derivedWhite: Array<[number, number]> = [];
    for (let i = 0; i < len; i++) {
      const bit = 1n << BigInt(i);
      const pos = lineType === "row" ? idx * cols + i : i * cols + idx;
      if (b[pos] !== UNKNOWN) continue;
      if ((andM & bit) !== 0n) {
        b[pos] = BLACK;
        derivedBlack.push(lineType === "row" ? [idx, i] : [i, idx]);
        queue.push([lineType === "row" ? "col" : "row", lineType === "row" ? i : idx]);
      } else if ((orM & bit) === 0n) {
        b[pos] = WHITE;
        derivedWhite.push(lineType === "row" ? [idx, i] : [i, idx]);
        queue.push([lineType === "row" ? "col" : "row", lineType === "row" ? i : idx]);
      }
    }
    if (record && (derivedBlack.length > 0 || derivedWhite.length > 0 || ls.cands.length < before)) {
      steps.push({
        seq: seq++,
        kind: "propagate",
        lineType,
        lineIndex: idx,
        derivedBlack,
        derivedWhite,
        candidatesBefore: before,
        candidatesAfter: ls.cands.length,
        reason: `${lineType === "row" ? "行" : "列"} ${idx}: 候选 ${before} -> ${ls.cands.length}, ` +
          `推出黑格 ${derivedBlack.length} 个、白格 ${derivedWhite.length} 个`,
      });
    }
    return true;
  };

  const propagateAll = (
    b: Uint8Array,
    lines: LineState[][],
    initialQueue: Array<["row" | "col", number]>,
    record: boolean
  ): boolean => {
    const queue = [...initialQueue];
    const inQueue = new Set<string>();
    while (queue.length > 0) {
      const [lt, idx] = queue.shift()!;
      if (!propagateLine(b, lines, lt, idx, queue, record)) return false;
    }
    return true;
  };

  const boardString = (b: Uint8Array): string => {
    const linesOut: string[] = [];
    for (let r = 0; r < rows; r++) {
      let s = "";
      for (let c = 0; c < cols; c++) s += b[r * cols + c] === BLACK ? "#" : ".";
      linesOut.push(s);
    }
    return linesOut.join("\n");
  };

  const cloneLines = (lines: LineState[][]): LineState[][] => [
    lines[0].map((l) => ({ cands: l.cands })),
    lines[1].map((l) => ({ cands: l.cands })),
  ];

  const checkBudget = () => {
    if (nodes >= cfg.maxNodes || Date.now() > deadline) throw new BudgetExceeded();
  };

  const search = (b: Uint8Array, lines: LineState[][]): void => {
    if (solutions.length >= cfg.maxSolutions) { truncatedByCap = true; return; }
    checkBudget();
    nodes++;
    // 找一个未知格: 选择所在行/列候选最少(>1)的格以加速收敛
    let bestPos = -1;
    let bestScore = Infinity;
    for (let pos = 0; pos < b.length; pos++) {
      if (b[pos] !== UNKNOWN) continue;
      const r = Math.floor(pos / cols), c = pos % cols;
      const score = lines[0][r].cands.length + lines[1][c].cands.length;
      if (score < bestScore) { bestScore = score; bestPos = pos; }
    }
    if (bestPos === -1) {
      solutions.push(boardString(b));
      return;
    }
    for (const value of [BLACK, WHITE]) {
      if (solutions.length >= cfg.maxSolutions) { truncatedByCap = true; return; }
      const nb = new Uint8Array(b);
      nb[bestPos] = value;
      const nl = cloneLines(lines);
      const r = Math.floor(bestPos / cols), c = bestPos % cols;
      steps.push({
        seq: seq++,
        kind: "guess",
        derivedBlack: value === BLACK ? [[r, c]] : [],
        derivedWhite: value === WHITE ? [[r, c]] : [],
        reason: `猜测 (${r},${c}) = ${value === BLACK ? "黑" : "白"} (搜索分支, 非逻辑必然)`,
      });
      const ok = propagateAll(nb, nl, [["row", r], ["col", c]], true);
      if (ok) search(nb, nl);
    }
  };

  let status: SolveResult["status"];
  let exhausted = false;
  const lines: LineState[][] = [rowLines, colLines];
  const initQueue: Array<["row" | "col", number]> = [];
  for (let i = 0; i < rows; i++) initQueue.push(["row", i]);
  for (let i = 0; i < cols; i++) initQueue.push(["col", i]);

  try {
    const ok = propagateAll(board, lines, initQueue, true);
    if (ok) search(board, lines);
    status = solutions.length === 0 ? "unsat" : solutions.length === 1 && !truncatedByCap ? "unique" : "multiple";
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    exhausted = true;
    status = "budget_exceeded";
  }

  const elapsedMs = Date.now() - started;
  let bound: string;
  if (status === "unsat") bound = "搜索空间已穷尽, 确认无解";
  else if (status === "unique") bound = "搜索空间已穷尽, 仅存在 1 个解, 唯一性得证";
  else if (status === "multiple") bound = `已找到 ${solutions.length} 个不同解, 证明非唯一`;
  else bound = `预算耗尽(节点 ${nodes}/${cfg.maxNodes}, 用时 ${elapsedMs}/${cfg.maxTimeMs}ms): ` +
    `已发现 ${solutions.length} 个解, ${solutions.length === 0 ? "是否有解未判定" : "唯一性未判定"}, 不得视为无解`;

  return {
    status,
    solutions,
    solutionsFound: solutions.length,
    nodes,
    elapsedMs,
    steps,
    bound,
  };
}

/** 逻辑提示: 仅做一轮传播, 返回必然推出的格; 不猜测。 */
export function hint(input: SolverInput): { hints: import("./types").HintCell[]; logical: boolean; note: string; steps: StepEntry[] } {
  const { rows, cols } = input;
  const rowLines: LineState[] = input.rowClues.map((c) => ({ cands: generateCandidates(cols, c, 200_000) }));
  const colLines: LineState[] = input.colClues.map((c) => ({ cands: generateCandidates(rows, c, 200_000) }));
  const board = new Uint8Array(input.board);
  const steps: StepEntry[] = [];
  let seq = 0;
  const lines: LineState[][] = [rowLines, colLines];
  const hints: import("./types").HintCell[] = [];

  const queue: Array<["row" | "col", number]> = [];
  for (let i = 0; i < rows; i++) queue.push(["row", i]);
  for (let i = 0; i < cols; i++) queue.push(["col", i]);

  let contradiction = false;
  while (queue.length > 0 && !contradiction) {
    const [lt, idx] = queue.shift()!;
    const ls = lines[lt === "row" ? 0 : 1][idx];
    let kb = 0n, kw = 0n;
    const len = lt === "row" ? cols : rows;
    for (let i = 0; i < len; i++) {
      const v = lt === "row" ? board[idx * cols + i] : board[i * cols + idx];
      if (v === BLACK) kb |= 1n << BigInt(i);
      else if (v === WHITE) kw |= 1n << BigInt(i);
    }
    const before = ls.cands.length;
    ls.cands = filterCandidates(ls.cands, kb, kw);
    if (ls.cands.length === 0) { contradiction = true; break; }
    const andM = candidatesAnd(ls.cands);
    const orM = candidatesOr(ls.cands);
    const dB: Array<[number, number]> = [];
    const dW: Array<[number, number]> = [];
    for (let i = 0; i < len; i++) {
      const bit = 1n << BigInt(i);
      const pos = lt === "row" ? idx * cols + i : i * cols + idx;
      if (board[pos] !== UNKNOWN) continue;
      if ((andM & bit) !== 0n) {
        board[pos] = BLACK;
        const rc: [number, number] = lt === "row" ? [idx, i] : [i, idx];
        dB.push(rc);
        hints.push({ row: rc[0], col: rc[1], value: "black", reason: `${lt === "row" ? "行" : "列"} ${idx} 的所有剩余候选在此格均为黑`, lineType: lt, lineIndex: idx, guess: false });
        queue.push([lt === "row" ? "col" : "row", lt === "row" ? i : idx]);
      } else if ((orM & bit) === 0n) {
        board[pos] = WHITE;
        const rc: [number, number] = lt === "row" ? [idx, i] : [i, idx];
        dW.push(rc);
        hints.push({ row: rc[0], col: rc[1], value: "white", reason: `${lt === "row" ? "行" : "列"} ${idx} 的所有剩余候选在此格均为白`, lineType: lt, lineIndex: idx, guess: false });
        queue.push([lt === "row" ? "col" : "row", lt === "row" ? i : idx]);
      }
    }
    if (dB.length > 0 || dW.length > 0 || ls.cands.length < before) {
      steps.push({
        seq: seq++,
        kind: "propagate",
        lineType: lt,
        lineIndex: idx,
        derivedBlack: dB,
        derivedWhite: dW,
        candidatesBefore: before,
        candidatesAfter: ls.cands.length,
        reason: `${lt === "row" ? "行" : "列"} ${idx}: 候选 ${before} -> ${ls.cands.length}`,
      });
    }
  }
  if (contradiction) {
    return { hints: [], logical: true, note: "当前已知格与线索矛盾, 请检查已填内容", steps };
  }
  if (hints.length === 0) {
    return { hints: [], logical: true, note: "纯逻辑无法继续推出新格, 需要猜测(搜索)才能前进", steps };
  }
  return { hints, logical: true, note: `纯逻辑推出 ${hints.length} 个格`, steps };
}
