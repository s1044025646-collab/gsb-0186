import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Store } from "./db.ts";
import { NonogramService } from "./service.ts";
import { ValidationError } from "./validate.ts";

const PORT = Number(process.env.PORT ?? process.env.NONOGRAM_PORT ?? 3000);
const DATA_DIR = process.env.NONOGRAM_DATA ?? resolve("data");
const DB_PATH = resolve(DATA_DIR, "nonogram.db");

const store = new Store(DB_PATH);
const service = new NonogramService(store);

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return {};
  return JSON.parse(raw);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  try {
    // 健康检查
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, db: DB_PATH });
    }

    // 导入题面
    if (req.method === "POST" && path === "/puzzles") {
      const body = await readJson(req);
      const { puzzle, knownVersion } = service.importPuzzle(body);
      return send(res, 201, { puzzleId: puzzle.id, uuid: puzzle.uuid, knownVersion });
    }

    // 列出谜题
    if (req.method === "GET" && path === "/puzzles") {
      return send(res, 200, service.listPuzzles());
    }

    const mPuzzle = path.match(/^\/puzzles\/(\d+)$/);
    const mKnown = path.match(/^\/puzzles\/(\d+)\/known$/);
    const mSolve = path.match(/^\/puzzles\/(\d+)\/solve$/);
    const mHint = path.match(/^\/puzzles\/(\d+)\/hint$/);
    const mResults = path.match(/^\/puzzles\/(\d+)\/results$/);
    const mExport = path.match(/^\/puzzles\/(\d+)\/export$/);
    const mResult = path.match(/^\/results\/(\d+)$/);

    if (req.method === "GET" && mPuzzle) {
      const id = Number(mPuzzle[1]);
      const knownVersion = url.searchParams.get("knownVersion")
        ? Number(url.searchParams.get("knownVersion"))
        : undefined;
      return send(res, 200, service.check(id, knownVersion));
    }
    if (req.method === "POST" && mKnown) {
      const id = Number(mKnown[1]);
      const body = (await readJson(req)) as { known?: unknown };
      if (!Array.isArray(body.known)) throw new ValidationError("body.known 必须是数组");
      const out = service.updateKnown(id, body.known as never);
      return send(res, 201, out);
    }
    if (req.method === "POST" && mSolve) {
      const id = Number(mSolve[1]);
      const body = (await readJson(req)) as { knownVersion?: number; config?: never };
      const out = service.solve(id, {
        knownVersion: body.knownVersion,
        config: body.config,
      });
      return send(res, 200, {
        resultId: out.stored.id,
        knownVersion: out.knownVersion,
        ...serializeResult(out.result),
      });
    }
    if (req.method === "GET" && mHint) {
      const id = Number(mHint[1]);
      const knownVersion = url.searchParams.get("knownVersion")
        ? Number(url.searchParams.get("knownVersion"))
        : undefined;
      return send(res, 200, service.hint(id, knownVersion));
    }
    if (req.method === "GET" && mResults) {
      const id = Number(mResults[1]);
      return send(res, 200, service.listResults(id));
    }
    if (req.method === "GET" && mExport) {
      const id = Number(mExport[1]);
      const knownVersion = url.searchParams.get("knownVersion")
        ? Number(url.searchParams.get("knownVersion"))
        : undefined;
      return send(res, 200, service.export(id, knownVersion));
    }
    if (req.method === "GET" && mResult) {
      const id = Number(mResult[1]);
      const r = service.getResult(id);
      return send(res, 200, {
        ...r,
        result: JSON.parse(r.result) as unknown,
        config: JSON.parse(r.config) as unknown,
      });
    }

    // 线索反算
    if (req.method === "POST" && path === "/reverse-clues") {
      const body = (await readJson(req)) as { rows?: string[] };
      if (!Array.isArray(body.rows)) throw new ValidationError("body.rows 必须为字符串数组");
      return send(res, 200, service.reverseClues(body.rows));
    }

    return send(res, 404, { error: "not found", method: req.method, path });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof SyntaxError) {
      return send(res, 400, { error: err.message });
    }
    return send(res, 500, { error: (err as Error).message });
  }
});

function serializeResult(result: import("./types.ts").SolveResult) {
  return {
    outcome: result.outcome,
    solutionCount: result.solutionCount,
    nodesVisited: result.nodesVisited,
    elapsedMs: result.elapsedMs,
    budgetExhausted: result.budgetExhausted,
    boundary: result.boundary,
    witnesses: result.witnesses.map((w) => ({ grid: w, ascii: w.map((row) => row.map((c) => (c === 1 ? "█" : "·")).join("")) })),
    steps: result.steps,
  };
}

server.listen(PORT, () => {
  console.log(`数织后端已启动: http://localhost:${PORT}`);
  console.log(`数据目录/数据库: ${DB_PATH}`);
});
