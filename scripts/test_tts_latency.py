#!/usr/bin/env python3
"""
ElevenLabs TTS Latency Benchmark
Measures: time-to-first-byte, total generation time, audio chunks, data size
"""

import asyncio
import json
import os
import time
import base64
import sys

try:
    import websockets
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets

# Config
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "YOUR_KEY_HERE")
VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel
MODEL_ID = "eleven_flash_v2_5"
OUTPUT_FORMAT = "mp3_44100_128"

# Test sentences (Vietnamese — typical translation output)
TEST_SENTENCES = [
    "tôi nghiên cứu về hạnh phúc.",
    "khoảng 2 năm nay, hay lâu hơn chút, à, khoảng mỗi 3 tháng một lần.",
    "nó hiện ra dưới dạng sức khỏe, hạnh phúc, phúc lợi. Sức khỏe, hạnh phúc và phúc lợi, có thể nghe hơi bất ngờ vì là cùng một từ.",
    "Nhưng tâm trí tôi thì hoàn toàn rối bời, không ai có thể tin tôi được. Tôi ở một mình.",
]


async def benchmark_sentence(sentence: str, run_id: int) -> dict:
    """Benchmark a single TTS request"""
    url = (
        f"wss://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream-input"
        f"?model_id={MODEL_ID}&output_format={OUTPUT_FORMAT}"
    )

    result = {
        "run_id": run_id,
        "text_length": len(sentence),
        "chunks": 0,
        "total_audio_bytes": 0,
        "ttfb_ms": None,  # time to first byte
        "total_ms": None,
        "error": None,
    }

    try:
        t_start = time.monotonic()

        async with websockets.connect(url) as ws:
            t_connected = time.monotonic()
            result["connect_ms"] = round((t_connected - t_start) * 1000, 1)

            # Send BOS
            await ws.send(json.dumps({
                "text": " ",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                "xi_api_key": API_KEY,
            }))

            # Send text with flush
            await ws.send(json.dumps({
                "text": sentence + " ",
                "flush": True,
            }))

            t_text_sent = time.monotonic()

            # Send EOS
            await ws.send(json.dumps({"text": ""}))

            # Receive audio chunks
            t_first_audio = None
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10.0)
                    data = json.loads(msg)

                    if data.get("audio"):
                        if t_first_audio is None:
                            t_first_audio = time.monotonic()
                            result["ttfb_ms"] = round((t_first_audio - t_text_sent) * 1000, 1)

                        audio_bytes = base64.b64decode(data["audio"])
                        result["chunks"] += 1
                        result["total_audio_bytes"] += len(audio_bytes)

                    if data.get("isFinal"):
                        break

                except asyncio.TimeoutError:
                    break

            t_end = time.monotonic()
            result["total_ms"] = round((t_end - t_text_sent) * 1000, 1)

    except Exception as e:
        result["error"] = str(e)

    return result


async def main():
    print("=" * 70)
    print("ElevenLabs Flash v2.5 — TTS Latency Benchmark")
    print(f"Voice: Rachel ({VOICE_ID})")
    print(f"Model: {MODEL_ID}")
    print(f"Format: {OUTPUT_FORMAT}")
    print("=" * 70)

    all_results = []

    for i, sentence in enumerate(TEST_SENTENCES):
        print(f"\n--- Test {i+1}/{len(TEST_SENTENCES)} ---")
        print(f"Text ({len(sentence)} chars): \"{sentence[:60]}{'...' if len(sentence)>60 else ''}\"")

        result = await benchmark_sentence(sentence, i + 1)
        all_results.append(result)

        if result["error"]:
            print(f"  ❌ ERROR: {result['error']}")
        else:
            print(f"  Connect:    {result['connect_ms']:>7.1f} ms")
            print(f"  TTFB:       {result['ttfb_ms']:>7.1f} ms  ← time to first audio")
            print(f"  Total:      {result['total_ms']:>7.1f} ms")
            print(f"  Chunks:     {result['chunks']:>7d}")
            print(f"  Audio size: {result['total_audio_bytes']:>7d} bytes ({result['total_audio_bytes']/1024:.1f} KB)")
            print(f"  Throughput: {result['text_length'] / (result['total_ms']/1000):.0f} chars/sec")

        # Small delay between tests
        await asyncio.sleep(0.5)

    # Summary
    successful = [r for r in all_results if not r["error"]]
    if successful:
        avg_ttfb = sum(r["ttfb_ms"] for r in successful) / len(successful)
        min_ttfb = min(r["ttfb_ms"] for r in successful)
        max_ttfb = max(r["ttfb_ms"] for r in successful)
        avg_total = sum(r["total_ms"] for r in successful) / len(successful)
        total_chars = sum(r["text_length"] for r in successful)
        total_audio = sum(r["total_audio_bytes"] for r in successful)
        total_chunks = sum(r["chunks"] for r in successful)

        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)
        print(f"  Tests:        {len(successful)}/{len(all_results)} passed")
        print(f"  TTFB:         avg={avg_ttfb:.0f}ms  min={min_ttfb:.0f}ms  max={max_ttfb:.0f}ms")
        print(f"  Total time:   avg={avg_total:.0f}ms")
        print(f"  Total chars:  {total_chars}")
        print(f"  Total audio:  {total_audio/1024:.1f} KB ({total_chunks} chunks)")
        print(f"  Avg chunk:    {total_audio/total_chunks/1024:.1f} KB")
        print(f"  Audio ratio:  {total_audio/total_chars:.0f} bytes/char")
        print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
