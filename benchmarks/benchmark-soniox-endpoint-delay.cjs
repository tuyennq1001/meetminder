/**
 * Soniox latency benchmark — focus on endpoint-delay tuning.
 *
 * Motivation: user feedback (Tuan Vu) — Soniox shows source provisional
 * continuously but TRANSLATION lags 2-3s. Hypothesis: the lag is Soniox's
 * endpoint detection (max_endpoint_delay_ms), not app overhead.
 *
 * This sweeps max_endpoint_delay_ms to quantify how much of the translation
 * lag is tunable vs an API floor.
 *
 * Mirrors production desktop client (src/js/soniox.js, model stt-rt-v4):
 *   - audio_format pcm_s16le, 16kHz mono
 *   - enable_endpoint_detection: true
 *   - one_way translation JA -> VI
 *
 * Metrics per config:
 *   - firstOrigProv_ms : first source provisional token (ASR responsiveness)
 *   - firstOrigFinal_ms: first finalized source segment
 *   - firstTransFinal_ms: first finalized TRANSLATION (what the user waits for)
 *   - origToTrans_ms   : gap final-original -> final-translation
 *   - segs, tgtChars, errors
 *
 * Usage: node benchmark-soniox-endpoint-delay.cjs
 * Output: results/benchmark-soniox-endpoint-delay-result.json
 */

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ENV = parseEnv(path.join(__dirname, ".env.local"));
// 16kHz mono PCM s16le sample. Override with BENCH_PCM_16K env var.
const PCM_16K =
  process.env.BENCH_PCM_16K ||
  path.join(__dirname, "..", "live-test", "hope-v2-trim-16k.pcm");
const CHUNK_MS = 100;
const TAIL_MS = 8000;
const SONIOX_ENDPOINT = "wss://stt-rt.soniox.com/transcribe-websocket";

// Sweep these endpoint delays (ms). 3000 = current production default.
const ENDPOINT_DELAYS = [300, 1000, 3000];
const SOURCE_LANG = "ja";
const TARGET_LANG = "vi";

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pcmChunks(file, sampleRate) {
  const buf = fs.readFileSync(file);
  const bytesPerChunk = Math.floor((sampleRate * 2 * CHUNK_MS) / 1000);
  const chunks = [];
  for (let i = 0; i < buf.length; i += bytesPerChunk) {
    chunks.push(buf.slice(i, Math.min(i + bytesPerChunk, buf.length)));
  }
  return chunks;
}

async function runSoniox(endpointDelay) {
  const apiKey = ENV.SONIOX_API_KEY;
  if (!apiKey) throw new Error("SONIOX_API_KEY missing in .env.local");

  const ws = new WebSocket(SONIOX_ENDPOINT);

  return new Promise((resolve, reject) => {
    const start = Date.now();
    let firstOrigProv_ms = 0;
    let firstOrigFinal_ms = 0;
    let firstTransFinal_ms = 0;
    let lastOrigFinal_ms = 0;
    let segs = 0;
    let tgtChars = 0;
    let errors = 0;
    const sample = [];
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* */ }
      resolve({
        endpointDelay,
        firstOrigProv_ms,
        firstOrigFinal_ms,
        firstTransFinal_ms,
        origToTrans_ms:
          firstTransFinal_ms && firstOrigFinal_ms
            ? firstTransFinal_ms - firstOrigFinal_ms
            : 0,
        segs,
        tgtChars,
        errors,
        sample: sample.slice(0, 3),
      });
    };

    ws.on("open", () => {
      const configMsg = {
        api_key: apiKey,
        model: "stt-rt-v4",
        audio_format: "pcm_s16le",
        sample_rate: 16000,
        num_channels: 1,
        enable_endpoint_detection: true,
        max_endpoint_delay_ms: endpointDelay,
        enable_speaker_diarization: true,
        enable_language_identification: true,
        language_hints: [SOURCE_LANG],
        translation: { type: "one_way", target_language: TARGET_LANG },
      };
      ws.send(JSON.stringify(configMsg));

      (async () => {
        const chunks = pcmChunks(PCM_16K, 16000);
        const t0 = Date.now();
        for (let i = 0; i < chunks.length; i++) {
          const target = t0 + i * CHUNK_MS;
          const now = Date.now();
          if (target > now) await sleep(target - now);
          if (ws.readyState === WebSocket.OPEN) ws.send(chunks[i]);
        }
        // empty frame = end-of-audio signal (matches app disconnect)
        if (ws.readyState === WebSocket.OPEN) ws.send(new ArrayBuffer(0));
        await sleep(TAIL_MS);
        finish();
      })().catch((e) => {
        errors++;
        finish();
      });
    });

    ws.on("message", (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data.error_code) { errors++; return; }
      if (!data.tokens || data.tokens.length === 0) return;

      const ms = Date.now() - start;
      let origFinal = "";
      let origProv = "";
      let transFinal = "";

      for (const t of data.tokens) {
        if (t.text === "<end>") continue;
        if (t.translation_status === "original") {
          if (t.is_final) origFinal += t.text;
          else origProv += t.text;
        } else if (t.translation_status === "translation") {
          if (t.is_final) transFinal += t.text;
        } else if (t.translation_status === "none") {
          if (t.is_final) origFinal += t.text;
          else origProv += t.text;
        }
      }

      if (origProv.trim() && !firstOrigProv_ms) firstOrigProv_ms = ms;
      if (origFinal.trim()) {
        if (!firstOrigFinal_ms) firstOrigFinal_ms = ms;
        lastOrigFinal_ms = ms;
      }
      if (transFinal.trim()) {
        if (!firstTransFinal_ms) firstTransFinal_ms = ms;
        segs++;
        tgtChars += transFinal.length;
        if (sample.length < 3) sample.push(transFinal.trim());
      }
    });

    ws.on("error", (e) => { errors++; finish(); });
    ws.on("close", () => finish());
  });
}

(async () => {
  console.log("=== Soniox endpoint-delay sweep (JA -> VI) ===");
  console.log("Audio:", path.basename(PCM_16K), "| chunk", CHUNK_MS + "ms");
  console.log("Sweeping max_endpoint_delay_ms:", ENDPOINT_DELAYS.join(", "));
  console.log("");

  const results = [];
  for (const d of ENDPOINT_DELAYS) {
    process.stdout.write(`-- endpoint_delay=${d}ms ... `);
    try {
      const r = await runSoniox(d);
      results.push(r);
      console.log(
        `firstTransFinal=${r.firstTransFinal_ms}ms ` +
          `origProv=${r.firstOrigProv_ms}ms ` +
          `orig->trans=${r.origToTrans_ms}ms segs=${r.segs} err=${r.errors}`
      );
    } catch (e) {
      console.log("ERROR:", e.message);
      results.push({ endpointDelay: d, error: e.message });
    }
    await sleep(2000); // breathe between runs
  }

  console.log("\n=== Summary ===");
  console.log("delay(ms) | firstTransFinal | firstOrigProv | orig->trans | segs");
  for (const r of results) {
    if (r.error) { console.log(`${r.endpointDelay} | ERROR ${r.error}`); continue; }
    console.log(
      `${String(r.endpointDelay).padStart(5)} | ` +
        `${String(r.firstTransFinal_ms).padStart(13)} | ` +
        `${String(r.firstOrigProv_ms).padStart(11)} | ` +
        `${String(r.origToTrans_ms).padStart(9)} | ${r.segs}`
    );
  }

  const outDir = path.join(__dirname, "results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, "benchmark-soniox-endpoint-delay-result.json");
  fs.writeFileSync(outFile, JSON.stringify({ ts: Date.now(), results }, null, 2));
  console.log("\nWrote", outFile);
})();
