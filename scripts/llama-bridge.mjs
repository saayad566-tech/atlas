// A long-lived inference worker.
//
// node-llama-cpp is ESM-only and Atlas is CommonJS, so the model lives here, in its own
// process, and answers newline-delimited JSON over stdio. Keeping it alive means the model
// is loaded once rather than on every question.
//
// Protocol: one JSON object per line on stdin {"id":1,"prompt":"…","system":"…","maxTokens":160}
//           one JSON object per line on stdout {"id":1,"answer":"…"} or {"id":1,"error":"…"}
import { createInterface } from 'node:readline';

const modelPath = process.argv[2];
if (!modelPath) { console.log(JSON.stringify({ ready: false, error: 'no model path' })); process.exit(1); }

let session = null;
let LlamaChatSession = null;
let ctx = null;

try {
  const mod = await import('node-llama-cpp');
  LlamaChatSession = mod.LlamaChatSession;
  const llama = await mod.getLlama({ gpu: false });
  const model = await llama.loadModel({ modelPath });
  ctx = await model.createContext({ contextSize: 1024, threads: 2 });
  console.log(JSON.stringify({ ready: true, size: model.size }));
} catch (e) {
  const msg = String(e && e.message ? e.message : e);
  // An optional dependency that was never installed is not a crash: say so plainly and let
  // the caller fall back to the deterministic answer path.
  const friendly = /Cannot find package|ERR_MODULE_NOT_FOUND/.test(msg)
    ? 'node-llama-cpp is not installed — run: npm install node-llama-cpp'
    : msg.slice(0, 300);
  console.log(JSON.stringify({ ready: false, error: friendly }));
  process.exit(1);
}

const rl = createInterface({ input: process.stdin });

// Questions are answered one at a time. Firing them concurrently starves the context of
// sequences and interleaves two generations on the same model.
let queue = Promise.resolve();

async function handle(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  let sequence = null;
  try {
    // One sequence per question, released afterwards: a context has a fixed number of
    // sequences, so failing to release starves the worker after the first answer.
    sequence = ctx.getSequence();
    session = new LlamaChatSession({ contextSequence: sequence });
    const answer = await session.prompt(`${msg.system ?? ''}\n\n${msg.prompt ?? ''}`, {
      maxTokens: Math.min(Math.max(Number(msg.maxTokens ?? 160), 16), 512),
      temperature: 0.2,
    });
    console.log(JSON.stringify({ id: msg.id, answer: String(answer ?? '').trim() }));
  } catch (e) {
    console.log(JSON.stringify({ id: msg.id, error: String(e && e.message ? e.message : e).slice(0, 200) }));
  } finally {
    try { if (sequence) sequence.dispose(); } catch { /* already released */ }
    session = null;
  }
}

rl.on('line', (line) => { queue = queue.then(() => handle(line)); });
// Do not exit on stdin close until every queued question has been answered: a piped
// invocation closes stdin immediately, and exiting there would discard the answer.
rl.on('close', () => { queue.then(() => process.exit(0)); });
