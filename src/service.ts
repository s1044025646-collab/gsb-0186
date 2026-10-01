import { randomUUID } from "node:crypto";
import { Store, type StoredPuzzle, type StoredResult } from "./db.ts";
import { cluesFromGrid, gridSatisfies, gridToStrings, parseRows } from "./grid.ts";
import { logicalHint, solve } from "./solver.ts";
import type {
  Cell,
  PuzzleInput,
  SolveConfig,
  SolveResult,
  StepRecord,
} from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";
import { validatePuzzle, ValidationError } from "./validate.ts";

export class NonogramService {
  private readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  /** 导入题面（做完整校验）并落库；空 known 作为版本 1。 */
  importPuzzle(raw: unknown): { puzzle: StoredPuzzle; knownVersion: number } {
    const p = validatePuzzle(raw);
    const uuid = randomUUID();
    const stored = this.store.insertPuzzle(uuid, p);
    const kv = this.store.addKnownVersion(stored.id, p.known ?? []);
    return { puzzle: stored, knownVersion: kv.version };
  }

  toPuzzleInput(stored: StoredPuzzle, knownVersion?: number): PuzzleInput {
    const version = knownVersion ?? this.latestKnownVersion(stored.id);
    const kv = this.store.getKnownVersion(stored.id, version);
    if (!kv) throw new ValidationError(`已知格版本 ${version} 不存在`);
    return {
      name: stored.name ?? undefined,
      rows: stored.rows,
      cols: stored.cols,
      rowClues: JSON.parse(stored.row_clues) as number[][],
      colClues: JSON.parse(stored.col_clues) as number[][],
      known: JSON.parse(kv.known) as { r: number; c: number; v: Cell }[],
    };
  }

  latestKnownVersion(puzzleId: number): number {
    const versions = this.store.listKnownVersions(puzzleId);
    if (versions.length === 0) throw new ValidationError("该谜题没有任何已知格版本");
    return versions[versions.length - 1]!.version;
  }

  /** 检查题面/某版本：只做校验与快速可满足性信息，不做完整搜索。 */
  check(puzzleId: number, knownVersion?: number): {
    puzzle: PuzzleInput;
    knownVersion: number;
  } {
    const stored = this.requirePuzzle(puzzleId);
    const version = knownVersion ?? this.latestKnownVersion(puzzleId);
    return { puzzle: this.toPuzzleInput(stored, version), knownVersion: version };
  }

  /** 追加已知格，产生新版本；旧版本与旧结果保持不变。 */
  updateKnown(
    puzzleId: number,
    known: { r: number; c: number; v: Cell }[],
  ): { knownVersion: number } {
    const stored = this.requirePuzzle(puzzleId);
    // 用完整题面再走一次校验，确保坐标/值合法。
    const base = this.toPuzzleInput(stored, this.latestKnownVersion(puzzleId));
    validatePuzzle({ ...base, known });
    const kv = this.store.addKnownVersion(stored.id, known);
    return { knownVersion: kv.version };
  }

  solve(
    puzzleId: number,
    opts: { knownVersion?: number; config?: Partial<SolveConfig> } = {},
  ): { result: SolveResult; stored: StoredResult; knownVersion: number } {
    const stored = this.requirePuzzle(puzzleId);
    const version = opts.knownVersion ?? this.latestKnownVersion(puzzleId);
    const puzzle = this.toPuzzleInput(stored, version);
    const config: SolveConfig = { ...DEFAULT_CONFIG, ...opts.config };
    const result = solve(puzzle, config);
    const saved = this.store.saveResult(stored.id, version, config, result);
    return { result, stored: saved, knownVersion: version };
  }

  hint(puzzleId: number, knownVersion?: number): {
    feasible: boolean;
    complete: boolean;
    steps: StepRecord[];
  } {
    const stored = this.requirePuzzle(puzzleId);
    const version = knownVersion ?? this.latestKnownVersion(puzzleId);
    const puzzle = this.toPuzzleInput(stored, version);
    // 校验一遍题面
    validatePuzzle(puzzle);
    return logicalHint(puzzle);
  }

  getResult(resultId: number): StoredResult {
    const r = this.store.getResult(resultId);
    if (!r) throw new ValidationError(`结果 ${resultId} 不存在`);
    return r;
  }

  listResults(puzzleId: number): StoredResult[] {
    return this.store.listResults(puzzleId);
  }

  listPuzzles(): StoredPuzzle[] {
    return this.store.listPuzzles();
  }

  /** 从完整字符棋盘反算线索。 */
  reverseClues(rows: string[]) {
    const grid = parseRows(rows);
    return cluesFromGrid(grid);
  }

  /** 导出谜题某版本 + 最新结果快照为 JSON。 */
  export(puzzleId: number, knownVersion?: number) {
    const stored = this.requirePuzzle(puzzleId);
    const version = knownVersion ?? this.latestKnownVersion(puzzleId);
    const puzzle = this.toPuzzleInput(stored, version);
    const results = this.store
      .listResults(puzzleId)
      .filter((r) => r.known_version === version)
      .map((r) => ({
        resultId: r.id,
        outcome: r.outcome,
        createdAt: r.created_at,
        config: JSON.parse(r.config) as SolveConfig,
        result: JSON.parse(r.result) as SolveResult,
      }));
    return {
      uuid: stored.uuid,
      name: stored.name,
      knownVersion: version,
      puzzle,
      results,
    };
  }

  /** 用线索核对一份解（通常是反算后再校验，演示用）。 */
  verify(grid: Cell[][], puzzle: PuzzleInput): boolean {
    return gridSatisfies(grid, puzzle.rowClues, puzzle.colClues);
  }

  renderWitness(result: SolveResult, index: 0 | 1 = 0): string[] {
    const w = result.witnesses[index];
    if (!w) return [];
    return gridToStrings(w);
  }

  private requirePuzzle(puzzleId: number): StoredPuzzle {
    const p = this.store.getPuzzleById(puzzleId);
    if (!p) throw new ValidationError(`谜题 ${puzzleId} 不存在`);
    return p;
  }
}

export { gridToStrings };
