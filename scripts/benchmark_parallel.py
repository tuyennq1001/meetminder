#!/usr/bin/env python3
"""
Benchmark parallel pipeline vs sequential.
Feeds same audio file, measures wall-clock time for all results.

Usage:
  python3 scripts/benchmark_parallel.py /tmp/test_ja_real.wav
"""

import sys
import os
import time
import wave
import json

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_sequential(wav_path, chunk_seconds=7, stride_seconds=5):
    """Run pipeline in sequential mode (like --test)."""
    from scripts.local_pipeline import LocalPipeline
    
    pipeline = LocalPipeline(
        asr_model="whisper",
        source_lang="ja",
        target_lang="vi",
        chunk_seconds=chunk_seconds,
        stride_seconds=stride_seconds,
    )

    with wave.open(wav_path, "r") as wf:
        pcm = wf.readframes(wf.getnframes())

    chunk_bytes = chunk_seconds * 16000 * 2
    stride_bytes = stride_seconds * 16000 * 2

    print(f"\n{'='*60}")
    print(f"SEQUENTIAL (ASR → Translate → next)")
    print(f"{'='*60}\n")

    t_start = time.time()
    pos = 0
    count = 0
    while pos + chunk_bytes <= len(pcm):
        chunk = pcm[pos:pos + chunk_bytes]
        pipeline._process_chunk(chunk)
        count += 1
        pos += stride_bytes

    if pos < len(pcm) and len(pcm) - pos > 16000 * 2:
        pipeline._process_chunk(pcm[pos:])
        count += 1

    total_wall = time.time() - t_start
    print(f"\nSequential: {count} chunks in {total_wall:.2f}s (avg {total_wall/count:.2f}s/chunk)")
    return total_wall, count


def run_parallel(wav_path, chunk_seconds=7, stride_seconds=5):
    """Run pipeline in parallel mode (ASR + Translate overlapped)."""
    import queue
    import threading
    from scripts.local_pipeline import LocalPipeline, log, emit

    pipeline = LocalPipeline(
        asr_model="whisper",
        source_lang="ja",
        target_lang="vi",
        chunk_seconds=chunk_seconds,
        stride_seconds=stride_seconds,
    )

    with wave.open(wav_path, "r") as wf:
        pcm = wf.readframes(wf.getnframes())

    chunk_bytes = chunk_seconds * 16000 * 2
    stride_bytes = stride_seconds * 16000 * 2

    print(f"\n{'='*60}")
    print(f"PARALLEL (ASR in main, Translate in worker)")
    print(f"{'='*60}\n")

    translate_queue = queue.Queue(maxsize=2)
    results = []

    def translate_worker():
        while True:
            item = translate_queue.get()
            if item is None:  # Poison pill
                break
            new_text, lang, t_asr = item
            t2 = time.time()
            translated = pipeline._translate(new_text)
            t_llm = time.time() - t2
            results.append({"asr": t_asr, "translate": t_llm})
            log(f"ASR={t_asr:.2f}s LLM={t_llm:.2f}s [parallel]")
            emit({
                "type": "result",
                "original": new_text,
                "translated": translated,
                "language": lang if isinstance(lang, str) else "ja",
                "timing": {"asr": round(t_asr, 2), "translate": round(t_llm, 2)},
            })
            translate_queue.task_done()

    worker = threading.Thread(target=translate_worker, daemon=True)
    worker.start()

    t_start = time.time()
    pos = 0
    count = 0

    while pos + chunk_bytes <= len(pcm):
        chunk = pcm[pos:pos + chunk_bytes]
        result = pipeline._process_chunk_asr(chunk)
        if result:
            new_text, lang, t_asr = result
            log(f"ASR done: {new_text[:40]}... ({t_asr:.2f}s)")
            translate_queue.put((new_text, lang, t_asr))
            count += 1
        pos += stride_bytes

    if pos < len(pcm) and len(pcm) - pos > 16000 * 2:
        result = pipeline._process_chunk_asr(pcm[pos:])
        if result:
            translate_queue.put(result)
            count += 1

    # Wait for all translations
    translate_queue.join()
    # Stop worker
    translate_queue.put(None)
    worker.join(timeout=5)

    total_wall = time.time() - t_start
    print(f"\nParallel: {count} chunks in {total_wall:.2f}s (avg {total_wall/count:.2f}s/chunk)")
    return total_wall, count


def main():
    wav_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/test_ja_real.wav"

    seq_time, seq_count = run_sequential(wav_path)
    par_time, par_count = run_parallel(wav_path)

    print(f"\n{'='*60}")
    print(f"COMPARISON")
    print(f"{'='*60}")
    print(f"Sequential: {seq_count} chunks in {seq_time:.2f}s ({seq_time/seq_count:.2f}s/chunk)")
    print(f"Parallel:   {par_count} chunks in {par_time:.2f}s ({par_time/par_count:.2f}s/chunk)")
    print(f"Speedup:    {seq_time/par_time:.2f}x ({(1-par_time/seq_time)*100:.1f}% faster)")
    print()


if __name__ == "__main__":
    main()
