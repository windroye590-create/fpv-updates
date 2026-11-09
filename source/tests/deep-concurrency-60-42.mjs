// Isolated concurrency / fault model, NOT a measurement of Google's live service.
// Runs the real Code.gs routing and storage logic behind a local HTTP transport.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
process.env.LITAKOVA_SERVER_SOURCE = new URL('../Code.gs', import.meta.url).pathname;
const {context, api, credential, spreadsheet, lock, instructorToken, regressionTest, regressionBody} = await import("./fixtures/server_model.mjs");

const SCALE = 100; // 100 model milliseconds per wall-clock millisecond.
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let seed = 42;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function retryDelay(attempt) { const cap = Math.min(10000 * 2 ** Math.min(Math.max(attempt - 1, 0), 5), 300000); return cap / 2 + random() * cap / 2; }
const group = api("POST", "/api/instructor/groups", instructorToken, {name: "Модель 30 одночасних курсантів"}).group;
const password = credential("isolated-model-password");
const cadets = Array.from({length: 60}, (_, index) => api("POST", "/api/register", "", {
  fullName: `Модельний курсант ${index + 1}`, username: `model_30_${index + 1}`, groupId: group.id, ...password
}));
const test = regressionTest("Ізольоване навантаження на 30", 2);
let active = 0, peak = 0, busy = false, executingOwner = false, busyResponses = 0, quotaResponses = 0, lostReplies = 0;
const dropped = new Set();
const quotaInjected = new Set();
lock.tryLock = () => executingOwner;
lock.releaseLock = () => {};
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const incoming = JSON.parse(raw).body;
  active += 1; peak = Math.max(peak, active);
  try {
    if (incoming.modelIndex % 11 === 0 && !quotaInjected.has(incoming.submissionId)) {
      quotaInjected.add(incoming.submissionId); quotaResponses += 1;
      response.writeHead(429); response.end("injected quota response"); return;
    }
    // Leave one of the model's 30 execution slots for an instructor/read request.
    if (active > 29) {
      quotaResponses += 1; response.writeHead(429); response.end("busy"); return;
    }
    if (busy) {
      await wait(2000 / SCALE);
      executingOwner = false;
      const value = context.doPost({postData: {contents: raw}}).text;
      assert.equal(JSON.parse(value).code, "BUSY");
      busyResponses += 1; response.end(value); return;
    }
    busy = true;
    try {
      // Model slow Sheet calls while the script-wide result lock is held.
      await wait(5000 / SCALE);
      executingOwner = true;
      const value = context.doPost({postData: {contents: raw}}).text;
      executingOwner = false;
      const body = JSON.parse(raw).body;
      if (Number(body.modelIndex) % 7 === 0 && !dropped.has(body.submissionId) && JSON.parse(value).ok) {
        dropped.add(body.submissionId); lostReplies += 1; request.socket.destroy(); return;
      }
      response.end(value);
    } finally { executingOwner = false; busy = false; }
  } finally { active -= 1; }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const queue = new Map(), attempts = new Map();
const started = Date.now();
try {
  await Promise.all(cadets.map(async (cadet, index) => {
    const submissionId = `model-30-${index}`;
    const body = {...regressionBody(test, submissionId), modelIndex: index};
    if (index % 2) body.answers[0].answerId = test.questions[0].answers[1].id;
    // Durable queue model: retries keep EXACTLY the same body and key until acknowledgement.
    queue.set(submissionId, JSON.stringify({action: "api", method: "POST", path: "/api/results", token: cadet.token, body}));
    await wait(random() * 8000 / SCALE);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      attempts.set(submissionId, attempt + 1);
      try {
        const reply = await fetch(url, {method: "POST", body: queue.get(submissionId)});
        if (reply.ok) {
          const accepted = await reply.json();
          if (accepted.ok) {
            assert.equal(String(accepted.result.userId), String(cadet.user.id));
            assert.equal(accepted.result.testId, test.id);
            queue.delete(submissionId); return;
          }
          assert.equal(accepted.code, "BUSY");
        } else assert.equal(reply.status, 429);
      } catch (error) { if (!(error instanceof TypeError)) throw error; }
      await wait(retryDelay(attempt + 1) / SCALE);
    }
    assert.fail(`Submission ${submissionId} did not drain`);
  }));
  const results = api("GET", "/api/instructor/lesson/" + test.id + "/" + group.id, instructorToken);
  assert.equal(queue.size, 0);
  assert.equal(results.cadets.length, 60);
  assert.equal(results.results.length, 60);
  assert.equal(new Set(results.results.map((r) => String(r.userId))).size, 60);
  assert.ok(busyResponses > 0); assert.ok(quotaResponses >= 3); assert.equal(lostReplies, 9);
  const report = {
    kind: "isolated_concurrency_fault_model", liveAppsScriptMeasured: false,
    participants: 60, accepted: results.results.length, duplicates: 0, pending: queue.size,
    slowSheetsModelMillis: 5000, executionSlotsModel: 30, reservedInstructorSlots: 1,
    busyResponses, quotaResponses, repliesLostAfterCommit: lostReplies,
    attempts: [...attempts.values()].reduce((sum, count) => sum + count, 0),
    wallClockMillis: Date.now() - started, simulationTimeScale: SCALE
  };
  const destination = new URL("../verification/stress/concurrency-60-42.json", import.meta.url);
  fs.mkdirSync(new URL("../verification/stress/", import.meta.url), {recursive: true});
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await new Promise((resolve) => server.close(resolve)); }
