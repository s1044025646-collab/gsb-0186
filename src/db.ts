import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { Given, PuzzleInput, SolveConfig, SolveResult } from "./types";
import { validatePuzzleInput } from "./puzzle";

const DATA_DIR = process.env.NONOGRAM_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.NONOGRAM_DB ?? path.join(DATA_DIR, "nonogram.db");

export function openDb(dbPath: string = DB_PATH): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS puzzles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rows INTEGER NOT NULL,
      cols INTEGER NOT NULL,
      row_clues TEXT NOT NULL,
      col_clues TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
      version_no INTEGER NOT NULL,
      givens TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(puzzle_id, version_no)
    );
    CREATE TABLE IF NOT EXISTS solve_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES versions(id),
      config TEXT NOT NULL,
      status TEXT NOT NULL,
      solutions_found INTEGER NOT NULL,
      nodes INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export function createPuzzle(db: DatabaseSync, input: PuzzleInput): { puzzleId: number; versionId: number } {
  const v = validatePuzzleInput(input);
  const ins = db.prepare(
    "INSERT INTO puzzles(name, rows, cols, row_clues, col_clues) VALUES (?,?,?,?,?)"
  ).run(v.name, v.rows, v.cols, JSON.stringify(v.rowClues), JSON.stringify(v.colClues));
  const puzzleId = Number(ins.lastInsertRowid);
  const versionId = addGivensVersion(db, puzzleId, v.givens);
  return { puzzleId, versionId };
}

/** 修改已知格 -> 产生新版本, 不污染旧版本与其求解结果 */
export function addGivensVersion(db: DatabaseSync, puzzleId: number, givens: Given[]): number {
  const row = db.prepare("SELECT rows, cols FROM puzzles WHERE id=?").get(puzzleId) as any;
  if (!row) throw new Error(`puzzle ${puzzleId} 不存在`);
  for (const g of givens) {
    if (g.row < 0 || g.row >= row.rows || g.col < 0 || g.col >= row.cols)
      throw new Error(`已知格坐标越界: (${g.row},${g.col})`);
    if (g.value !== "black" && g.value !== "white") throw new Error("已知格取值非法");
  }
  const cur = db.prepare("SELECT COALESCE(MAX(version_no),0) AS v FROM versions WHERE puzzle_id=?").get(puzzleId) as any;
  const versionNo = cur.v + 1;
  const ins = db.prepare("INSERT INTO versions(puzzle_id, version_no, givens) VALUES (?,?,?)")
    .run(puzzleId, versionNo, JSON.stringify(givens));
  return Number(ins.lastInsertRowid);
}

export function getPuzzle(db: DatabaseSync, puzzleId: number): any {
  const p = db.prepare("SELECT * FROM puzzles WHERE id=?").get(puzzleId) as any;
  if (!p) return null;
  return { ...p, row_clues: JSON.parse(p.row_clues), col_clues: JSON.parse(p.col_clues) };
}

export function listPuzzles(db: DatabaseSync): any[] {
  return (db.prepare("SELECT id, name, rows, cols, created_at FROM puzzles ORDER BY id").all() as any[]);
}

export function getVersion(db: DatabaseSync, versionId: number): any {
  const v = db.prepare("SELECT * FROM versions WHERE id=?").get(versionId) as any;
  if (!v) return null;
  return { ...v, givens: JSON.parse(v.givens) };
}

export function getLatestVersion(db: DatabaseSync, puzzleId: number): any {
  const v = db.prepare("SELECT * FROM versions WHERE puzzle_id=? ORDER BY version_no DESC LIMIT 1").get(puzzleId) as any;
  if (!v) return null;
  return { ...v, givens: JSON.parse(v.givens) };
}

export function saveRun(db: DatabaseSync, versionId: number, config: SolveConfig, result: SolveResult): number {
  const ins = db.prepare(
    "INSERT INTO solve_runs(version_id, config, status, solutions_found, nodes, elapsed_ms, result) VALUES (?,?,?,?,?,?,?)"
  ).run(versionId, JSON.stringify(config), result.status, result.solutionsFound, result.nodes, result.elapsedMs, JSON.stringify(result));
  return Number(ins.lastInsertRowid);
}

export function getRun(db: DatabaseSync, runId: number): any {
  const r = db.prepare("SELECT * FROM solve_runs WHERE id=?").get(runId) as any;
  if (!r) return null;
  return { ...r, config: JSON.parse(r.config), result: JSON.parse(r.result) };
}

export function listRuns(db: DatabaseSync, versionId?: number): any[] {
  const rows = versionId
    ? db.prepare("SELECT id, version_id, status, solutions_found, nodes, elapsed_ms, created_at FROM solve_runs WHERE version_id=? ORDER BY id").all(versionId)
    : db.prepare("SELECT id, version_id, status, solutions_found, nodes, elapsed_ms, created_at FROM solve_runs ORDER BY id").all();
  return rows as any[];
}
