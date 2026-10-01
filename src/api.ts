import * as http from "node:http";
import { openDb, createPuzzle, getPuzzle, listPuzzles, getVersion, getLatestVersion, addGivensVersion, saveRun, getRun, listRuns } from "./db";
import { validatePuzzleInput, givensToBoard, parseBoard, cluesFromBoard, renderBoard, ValidationError } from "./puzzle";
import { solve, hint } from "./solver";
import { SolveConfig } from "./types";

const PORT = Number(process.env.PORT ?? 8377);

function send(res: http.ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createServer(dbPath?: string): http.Server {
  const db = openDb(dbPath);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      // POST /puzzles  导入谜题
      if (req.method === "POST" && url.pathname === "/puzzles") {
        const body = await readBody(req);
        const { puzzleId, versionId } = createPuzzle(db, body);
        return send(res, 201, { puzzleId, versionId });
      }
      // GET /puzzles  列表
      if (req.method === "GET" && url.pathname === "/puzzles") {
        return send(res, 200, listPuzzles(db));
      }
      // GET /puzzles/:id
      if (req.method === "GET" && parts[0] === "puzzles" && parts.length === 2) {
        const p = getPuzzle(db, Number(parts[1]));
        return p ? send(res, 200, p) : send(res, 404, { error: "not found" });
      }
      // POST /puzzles/:id/check  校验题面
      if (req.method === "POST" && parts[0] === "puzzles" && parts[2] === "check") {
        const p = getPuzzle(db, Number(parts[1]));
        if (!p) return send(res, 404, { error: "not found" });
        try {
          validatePuzzleInput({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, givens: [] });
          return send(res, 200, { ok: true });
        } catch (e) {
          return send(res, 200, { ok: false, error: String((e as Error).message) });
        }
      }
      // POST /puzzles/:id/givens  修改已知格 -> 新版本
      if (req.method === "POST" && parts[0] === "puzzles" && parts[2] === "givens") {
        const body = await readBody(req);
        const versionId = addGivensVersion(db, Number(parts[1]), body.givens ?? []);
        return send(res, 201, { versionId });
      }
      // GET /puzzles/:id/export?versionId=
      if (req.method === "GET" && parts[0] === "puzzles" && parts[2] === "export") {
        const p = getPuzzle(db, Number(parts[1]));
        if (!p) return send(res, 404, { error: "not found" });
        const vid = url.searchParams.get("versionId");
        const v = vid ? getVersion(db, Number(vid)) : getLatestVersion(db, p.id);
        const board = givensToBoard(p.rows, p.cols, v?.givens ?? []);
        return send(res, 200, {
          puzzle: p, version: v,
          board: renderBoard(board, p.rows, p.cols),
        });
      }
      // POST /solve { versionId, config }
      if (req.method === "POST" && url.pathname === "/solve") {
        const body = await readBody(req);
        const v = getVersion(db, Number(body.versionId));
        if (!v) return send(res, 404, { error: "version not found" });
        const p = getPuzzle(db, v.puzzle_id);
        const board = givensToBoard(p.rows, p.cols, v.givens);
        const config: SolveConfig = body.config ?? {};
        const result = solve({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board }, config);
        const runId = saveRun(db, v.id, config, result);
        return send(res, 200, { runId, ...result });
      }
      // POST /hint { versionId }
      if (req.method === "POST" && url.pathname === "/hint") {
        const body = await readBody(req);
        const v = getVersion(db, Number(body.versionId));
        if (!v) return send(res, 404, { error: "version not found" });
        const p = getPuzzle(db, v.puzzle_id);
        const board = givensToBoard(p.rows, p.cols, v.givens);
        return send(res, 200, hint({ rows: p.rows, cols: p.cols, rowClues: p.row_clues, colClues: p.col_clues, board }));
      }
      // GET /runs/:id
      if (req.method === "GET" && parts[0] === "runs" && parts.length === 2) {
        const r = getRun(db, Number(parts[1]));
        return r ? send(res, 200, r) : send(res, 404, { error: "not found" });
      }
      // GET /runs?versionId=
      if (req.method === "GET" && url.pathname === "/runs") {
        const vid = url.searchParams.get("versionId");
        return send(res, 200, listRuns(db, vid ? Number(vid) : undefined));
      }
      // POST /clues/from-board { board: "文本棋盘" }
      if (req.method === "POST" && url.pathname === "/clues/from-board") {
        const body = await readBody(req);
        const { board, rows, cols } = parseBoard(String(body.board ?? ""));
        for (let i = 0; i < board.length; i++) {
          if (board[i] === 0) return send(res, 400, { error: "反算线索需要完整棋盘(不含 ?)" });
        }
        return send(res, 200, { rows, cols, ...cluesFromBoard(board, rows, cols) });
      }
      send(res, 404, { error: "unknown route" });
    } catch (e) {
      const code = e instanceof ValidationError || e instanceof SyntaxError ? 400 : 500;
      send(res, code, { error: String((e as Error).message) });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`nonogram API 已启动: http://localhost:${PORT} (数据目录可用 NONOGRAM_DATA_DIR 覆盖)`);
  });
}
