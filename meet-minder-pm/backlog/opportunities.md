# Opportunities

## OP1 — Choose a suitable re-transcription path

- **Job story:** When re-transcribing a saved meeting, I want to choose a cloud or local processing path, so I can control the trade-off between turnaround, privacy, and transcript quality.
- **Evidence:** [FB1] — one product owner reports a prior Gemini Transcribe failure and a successful Gemini Flash run whose quality has not yet been checked. [FB2] explicitly requests Gemini Transcribe as an additional option for testing.
- **Status:** open; Gemini Transcribe is approved as an experimental, selectable test option. Quality and reliability comparison remain pending.
- **Candidate solutions:** Offer Gemini Flash file processing, experimental Gemini Transcribe, and Local MLX as selectable choices. Keep Live Translate separate for live meetings; do not automatically switch engines when a selected route fails.
- **Outcome to measure:** Time to usable transcript and correction burden; baseline not yet measured.
