#!/usr/bin/env python3
"""
Benchmark: Compare translation models on same audio chunks.
Uses Whisper for ASR (same for all), swaps translation model.

Usage:
  python3 scripts/benchmark_translate.py --model nllb --test-file /tmp/test_ja_real.wav
  python3 scripts/benchmark_translate.py --model gemma --test-file /tmp/test_ja_real.wav
"""

import sys
import os
import json
import time
import wave
import tempfile
import numpy as np

os.environ["TOKENIZERS_PARALLELISM"] = "false"

def log(msg):
    print(f"[bench] {msg}", file=sys.stderr, flush=True)


class TranslationBenchmark:
    def __init__(self, translate_model="nllb", source_lang="ja", target_lang="vi",
                 chunk_seconds=7, stride_seconds=5):
        self.translate_model_type = translate_model
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.chunk_seconds = chunk_seconds
        self.stride_seconds = stride_seconds
        self.sample_rate = 16000
        self.prev_text = ""
        self.results = []

        self._load_models()

    def _load_models(self):
        # ASR: always Whisper
        log("Loading Whisper-large-v3-turbo (MLX)...")
        t = time.time()
        import mlx_whisper
        _dummy = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        with wave.open(_dummy.name, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00" * 3200)
        mlx_whisper.transcribe(
            _dummy.name,
            path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
            language="ja",
        )
        os.unlink(_dummy.name)
        self.asr_model = "mlx-community/whisper-large-v3-turbo"
        log(f"Whisper loaded in {time.time()-t:.1f}s")

        # Translation model
        if self.translate_model_type == "nllb":
            log("Loading NLLB-200-distilled-1.3B...")
            t = time.time()
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            self.nllb_tokenizer = AutoTokenizer.from_pretrained(
                "facebook/nllb-200-distilled-1.3B"
            )
            self.nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
                "facebook/nllb-200-distilled-1.3B"
            )
            log(f"NLLB loaded in {time.time()-t:.1f}s")

            # Warm up
            log("Warming up NLLB...")
            self._translate_nllb("テスト")
            log("NLLB ready")

        elif self.translate_model_type == "gemma":
            log("Loading Gemma-3-4B...")
            t = time.time()
            from mlx_lm import load
            self.llm_model, self.llm_tokenizer = load(
                "mlx-community/gemma-3-4b-it-qat-4bit"
            )
            log(f"Gemma loaded in {time.time()-t:.1f}s")
            log("Warming up Gemma...")
            self._translate_gemma("テスト")
            log("Gemma ready")

    def _translate_nllb(self, text):
        """Translate using NLLB-200."""
        if not text:
            return ""
        # NLLB language codes
        lang_map = {"vi": "vie_Latn", "en": "eng_Latn", "ja": "jpn_Jpan",
                     "ko": "kor_Hang", "zh": "zho_Hans"}
        src_code = lang_map.get(self.source_lang, "jpn_Jpan")
        tgt_code = lang_map.get(self.target_lang, "vie_Latn")

        self.nllb_tokenizer.src_lang = src_code
        inputs = self.nllb_tokenizer(text, return_tensors="pt", padding=True, truncation=True)
        import torch
        with torch.no_grad():
            generated = self.nllb_model.generate(
                **inputs,
                forced_bos_token_id=self.nllb_tokenizer.convert_tokens_to_ids(tgt_code),
                max_new_tokens=200,
            )
        result = self.nllb_tokenizer.decode(generated[0], skip_special_tokens=True)
        return result.strip()

    def _translate_gemma(self, text):
        """Translate using Gemma-3-4B."""
        if not text:
            return ""
        from mlx_lm import generate
        import re

        target_name = {"vi": "Vietnamese", "en": "English"}.get(self.target_lang, "Vietnamese")
        prompt = (
            "<start_of_turn>user\n"
            f"Translate this ONE Japanese sentence to {target_name}.\n"
            f"Output ONLY the {target_name} translation. ONE sentence only.\n\n"
            f"Translate: {text}\n"
            "<end_of_turn>\n"
            "<start_of_turn>model\n"
        )
        result = generate(self.llm_model, self.llm_tokenizer, prompt=prompt, max_tokens=100)
        result = result.split('<end_of_turn>')[0]
        result = re.sub(r'<[^>]+>', '', result)
        lines = [l.strip() for l in result.split('\n') if l.strip()]
        result = lines[0] if lines else ''
        result = re.sub(r'^(VI:\s*|→\s*|Translate:\s*)', '', result)
        return result.strip()

    def _translate(self, text):
        if self.translate_model_type == "nllb":
            return self._translate_nllb(text)
        else:
            return self._translate_gemma(text)

    def _dedup_transcript(self, text):
        if not self.prev_text or not text:
            return text
        prev = self.prev_text
        best_overlap = 0
        min_overlap = 3
        max_check = min(len(prev), len(text), 100)
        for length in range(min_overlap, max_check + 1):
            if prev[-length:] == text[:length]:
                best_overlap = length
        if best_overlap >= min_overlap:
            new_text = text[best_overlap:].strip()
            return new_text if new_text else text
        return text

    def process_chunk(self, pcm_bytes):
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        rms = np.sqrt(np.mean(samples.astype(np.float32) ** 2))
        if rms < 100:
            return None

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        with wave.open(tmp.name, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(pcm_bytes)

        try:
            # ASR
            import mlx_whisper
            t1 = time.time()
            result = mlx_whisper.transcribe(
                tmp.name,
                path_or_hf_repo=self.asr_model,
                language="ja",
                task="transcribe",
            )
            t_asr = time.time() - t1
            text = result.get("text", "").strip()

            if not text or text == self.prev_text:
                return None

            new_text = self._dedup_transcript(text)
            if not new_text or len(new_text) < 3:
                self.prev_text = text
                return None

            # Translate
            t2 = time.time()
            translated = self._translate(new_text)
            t_translate = time.time() - t2

            total = t_asr + t_translate

            result_data = {
                "original": new_text,
                "translated": translated,
                "asr_time": round(t_asr, 3),
                "translate_time": round(t_translate, 3),
                "total_time": round(total, 3),
            }
            self.results.append(result_data)
            self.prev_text = text

            log(f"ASR={t_asr:.2f}s TRL={t_translate:.2f}s total={total:.2f}s")
            log(f"  JA: {new_text[:60]}...")
            log(f"  VI: {translated[:60]}...")

            return result_data
        finally:
            os.unlink(tmp.name)

    def run_file(self, wav_path):
        with wave.open(wav_path, "r") as wf:
            pcm = wf.readframes(wf.getnframes())

        chunk_bytes = self.chunk_seconds * self.sample_rate * 2
        stride_bytes = self.stride_seconds * self.sample_rate * 2
        pos = 0

        log(f"\n{'='*60}")
        log(f"Model: {self.translate_model_type}")
        log(f"Chunk: {self.chunk_seconds}s, Stride: {self.stride_seconds}s")
        log(f"Audio: {len(pcm)/self.sample_rate/2:.1f}s")
        log(f"{'='*60}\n")

        while pos + chunk_bytes <= len(pcm):
            chunk = pcm[pos:pos + chunk_bytes]
            self.process_chunk(chunk)
            pos += stride_bytes

        # Remaining
        if pos < len(pcm) and len(pcm) - pos > self.sample_rate * 2:
            self.process_chunk(pcm[pos:])

        self.print_summary()

    def print_summary(self):
        if not self.results:
            log("No results!")
            return

        asr_times = [r["asr_time"] for r in self.results]
        trl_times = [r["translate_time"] for r in self.results]
        totals = [r["total_time"] for r in self.results]

        log(f"\n{'='*60}")
        log(f"SUMMARY: {self.translate_model_type.upper()}")
        log(f"{'='*60}")
        log(f"Chunks:        {len(self.results)}")
        log(f"Avg ASR:       {sum(asr_times)/len(asr_times):.3f}s")
        log(f"Avg Translate: {sum(trl_times)/len(trl_times):.3f}s")
        log(f"Avg Total:     {sum(totals)/len(totals):.3f}s")
        log(f"Min Total:     {min(totals):.3f}s")
        log(f"Max Total:     {max(totals):.3f}s")
        log(f"Effective lat: ~{self.chunk_seconds + sum(totals)/len(totals):.1f}s")
        log(f"{'='*60}\n")

        # Print JSON summary
        summary = {
            "model": self.translate_model_type,
            "chunk_seconds": self.chunk_seconds,
            "stride_seconds": self.stride_seconds,
            "num_chunks": len(self.results),
            "avg_asr": round(sum(asr_times)/len(asr_times), 3),
            "avg_translate": round(sum(trl_times)/len(trl_times), 3),
            "avg_total": round(sum(totals)/len(totals), 3),
            "results": self.results,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="nllb", choices=["nllb", "gemma"])
    parser.add_argument("--test-file", required=True)
    parser.add_argument("--source-lang", default="ja")
    parser.add_argument("--target-lang", default="vi")
    parser.add_argument("--chunk-seconds", type=int, default=7)
    parser.add_argument("--stride-seconds", type=int, default=5)
    args = parser.parse_args()

    bench = TranslationBenchmark(
        translate_model=args.model,
        source_lang=args.source_lang,
        target_lang=args.target_lang,
        chunk_seconds=args.chunk_seconds,
        stride_seconds=args.stride_seconds,
    )
    bench.run_file(args.test_file)


if __name__ == "__main__":
    main()
