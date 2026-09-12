# Meet Minder インストール＆設定ガイド (macOS)

macOS環境における **Meet Minder v1.0** のインストール、初期設定、および利用手順を解説した詳細ガイドです。

---

## 📌 システム要件

- **対応OS**: macOS 13.0 (Ventura) 以降
- **対応ハードウェア**:
  - **Apple Silicon** (M1 / M2 / M3 / M4) — 最高パフォーマンスおよび完全オフラインのLocal MLX音声翻訳をサポート。
  - **Intel Mac** (i5 / i7 / i9) — すべてのクラウドエンジン（Gemini、Soniox、OpenAI、Qwen）でスムーズに動作。
- **必要な権限**: 会議音声を正しく取得するため、**「画面とシステムオーディオの録音」** および **「マイク」** の権限許可が必要です。

---

## ステップ 1 — インストーラーのダウンロード (v1.0.0)

[**GitHub Releases — Meet Minder**](https://github.com/tuyennq1001/meetminder/releases/latest) にアクセスし、お使いのMacのアーキテクチャに合わせたファイルをダウンロードしてください。

| アーキテクチャ | インストーラーファイル | 対象デバイス |
| :--- | :--- | :--- |
| **Apple Silicon** | `MeetMinder_1.0.0_aarch64.dmg` | Apple M1, M2, M3, M4 搭載 Mac（MacBook, Mac mini, iMac, Mac Studio） |
| **Intel Mac** | `MeetMinder_1.0.0_x64.dmg` | Intel Core プロセッサ搭載の Mac 各機種 |

> [!TIP]
> **Macのプロセッサ確認方法:**
> 画面左上の ** (Apple)** メニュー ➔ **「このMacについて (About This Mac)」** を選択：
> - **「チップ: Apple M...」** と表示されている場合 ➔ **`aarch64`** 版を選択。
> - **「プロセッサ: Intel Core...」** と表示されている場合 ➔ **`x64`** 版を選択。

---

## ステップ 2 — アプリケーションのインストール

1. ダウンロードした `.dmg` ファイルをダブルクリックして開きます。
2. **Meet Minder** のアプリアイコンを **Applications (アプリケーション)** フォルダへドラッグ＆ドロップします。
3. DMGディスクを取り出し（Eject）、アプリケーションフォルダまたはSpotlight（`⌘ Space`）から **Meet Minder** を起動します。

---

## ステップ 3 — システム音声＆マイクのアクセス権限許可

アプリの初回起動時、macOSにより音声取得の権限確認ダイアログが表示されます：

1. **画面とシステムオーディオの録音権限 (Screen & System Audio Recording)**:
   - ダイアログが表示されたら **「システム設定を開く (Open System Settings)」** をクリックします。
   - リストから **Meet Minder** を探し、トグルスイッチを **オン (ON)** に切り替えます。
   - macOSから **「終了して再度開く (Quit & Reopen)」** を求められますので、ボタンをクリックして再起動します。
   > *※補足: Meet Minderは、オンライン会議アプリ（Zoom、Google Meet、Teams等）の出力音声を直接キャプチャするためにApple公式のScreenCaptureKit APIを使用しています。画面の映像や個人情報を録画することは一切ありません。*

2. **マイク権限 (Microphone)**:
   - 初回の会議翻訳開始時、マイクへのアクセス権限が要求されます。**「OK (許可)」** をクリックして自身の音声入力を有効にします。

---

## ステップ 4 — 音声翻訳エンジンの選択と設定

Meet Minderは5つの高度なAI音声翻訳ソリューションに対応しています。用途に合わせて選択してください：

![Meet Minder — 音声翻訳エンジン設定](user_manual/setting_gemini.png)

### 🥇 選択肢 1 (推奨・最優先): Google Gemini Multimodal Live API

> 🌟 **一番のおすすめ**: 極めて高い文脈理解力、WebSocketによるPCM双方向音声ストリーミング（超低遅延）、利用可能な最適モデルの自動検出、そして **Google AI Studioによる完全無料 (Free Tier)** 枠が提供されています。

- **利用費用**: **無料（0円）** — Google AI Studioの無料枠は非常に大きく、クレジットカード登録不要で日々の会議に十分利用できます。
- **主な特徴**:
  - 音声ストリームを受信しながらリアルタイムで高精度翻訳。
  - 会議の背景・目的、決定事項（Key Decisions）、ネクストアクション（Action Items）を自動整理する **高品質なAI議事録（Meeting Minutes）** を自動生成。
  - プロジェクト固有の専門用語集（Project Glossary）を自動反映。

**Google Gemini APIキーの取得手順（約30秒）:**
1. [**Google AI Studio**](https://aistudio.google.com) にアクセスします。
2. 個人のGoogleアカウントでログインします。
3. 左サイドバーの **「Get API key」** をクリックします。
4. **「Create API key」** をクリックし、生成されたキー（`AIzaSy...` から始まる文字列）をコピーします。
5. Meet Minderの設定画面（`⌘ ,`）➔ **「エンジン＆翻訳」** ➔ **「Google Gemini Live」** を選択 ➔ APIキーを貼り付け ➔ **「Test」** をクリックして接続を確認します。

---

### 🥈 選択肢 2: Local MLX (Apple Silicon 完全オフライン稼働)

> 🔒 **究極のプライバシー**: M1/M2/M3/M4チップのNeural EngineおよびGPUを活用し、端末内のみで音声認識と翻訳を実行します。

- **利用費用**: **永久無料**
- **動作要件**: Apple Silicon Mac、約5 GBの空き容量（Whisper + Gemmaモデル初回ダウンロード用）。
- **有効化手順**:
  1. 設定（`⌘ ,`）➔ **「エンジン＆翻訳」** ➔ **「Local MLX」** を選択。
  2. **「Local MLXモデルのインストール / 事前ダウンロード」** をクリック。
  3. ダウンロード完了後は、Wi-Fiを完全に切断した状態でも安全に音声翻訳を利用できます。

![Meet Minder — Local MLX設定](user_manual/setting_local_mlx.png)

---

### 🥉 その他の専門クラウドエンジン

- **Soniox Real-time STT (`stt-rt-v5`)**: 日本語からベトナム語・英語への業界最高水準の認識精度、格安従量課金（約$0.12/時間）、話者分離（Diarization）対応。[console.soniox.com](https://console.soniox.com) でキー取得。
- **OpenAI Realtime API**: 高度な双方向音声会話モデル。約$4.00/時間。[platform.openai.com](https://platform.openai.com) でキー取得。
- **Alibaba Qwen LiveTranslate Flash**: DashScopeプラットフォームによる高速多言語字幕翻訳（シンガポールリージョンキー推奨）。

---

### 📊 AIエンジン比較表

| 項目 | 🌟 Google Gemini Live | 🖥️ Local MLX | ☁️ Soniox STT | ⚡ OpenAI Realtime | 🌏 Qwen Live |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **費用** | **無料 (Free Tier)** | **完全無料** | 格安 (~$0.12/h) | 高価格 (~$4.00/h) | 無料プレビュー |
| **遅延速度** | 超低遅延 (~1–2秒) | 低遅延 (~2–3秒) | 最速 (<1秒) | 低遅延 (~1–2秒) | 最速 (~1秒) |
| **オフライン動作** | インターネット必須 | **可能 (100% Offline)**| インターネット必須 | インターネット必須 | インターネット必須 |
| **AI自動議事録** | **極めて優秀** | 基本的 | Gemini経由 | 良好 | 非対応 |
| **用語集登録** | **対応 (組み込み)** | プロンプト形式 | 対応 (API連携) | プロンプト形式 | 非対応 |
| **プライバシー** | 端末 ➔ Google 直接 | **最高 (端末完結)** | 端末 ➔ Soniox 直接 | 端末 ➔ OpenAI 直接 | 端末 ➔ Alibaba |
| **対応環境** | macOS & Windows | Apple Silicon (M1–M4) | macOS & Windows | macOS & Windows | macOS & Windows |

---

## ステップ 5 — Git自動バックアップ設定 (Auto Git Backup)

Meet Minderは、会議の全ログ、Markdownメモ、および音声ファイルをプライベートGitリポジトリに自動保存する機能を搭載しています：

![Gitバックアップ設定](user_manual/setting_backup.png)

1. 設定（`⌘ ,`）➔ **「ストレージ＆バックアップ」** を開きます。
2. **「Gitによるバックアップ」** スイッチを **オン** にします。
3. 自動化オプションを設定：
   - **会議終了時に自動コミット＆プッシュ**: 会議保存（`⌘ T`）を押した瞬間に自動同期。
   - **リモートへの自動定期プッシュ**: 一定間隔（15分・30分・60分）でGitHub / GitLabへ送信。
4. **「今すぐバックアップ」** ボタンをクリックして、即座に同期テストが行えます。

---

## ステップ 6 — 会議の開始と便利なショートカット

メイン画面（Live Overlay）の **Start** ボタンを押すか、以下の便利なキーボードショートカットで操作できます：

![Live Meeting 画面](user_manual/meetminder_live.png)

| ショートカット (macOS) | 機能・操作 |
| :--- | :--- |
| <kbd>⌘</kbd> + <kbd>S</kbd> | 翻訳の **開始 (Start)** / **一時停止 (Pause)** |
| <kbd>⌘</kbd> + <kbd>C</kbd> | 一時停止からの **再開 (Continue)** |
| <kbd>⌘</kbd> + <kbd>T</kbd> | **会議の終了 ＆ 保存 (Save & Stop)** |
| <kbd>⌘</kbd> + <kbd>N</kbd> | **メモ引き出し (Take Note Drawer) の開閉** |
| <kbd>⌘</kbd> + <kbd>L</kbd> | **リアルタイム画面 (Live Mode)** へ切り替え |
| <kbd>⌘</kbd> + <kbd>O</kbd> | **過去の会議録一覧 (Meeting Logs)** へ切り替え |
| <kbd>⌘</kbd> + <kbd>1</kbd> | 音声ソース: **システム音声（スピーカーのみ）** |
| <kbd>⌘</kbd> + <kbd>2</kbd> | 音声ソース: **マイク音声のみ** |
| <kbd>⌘</kbd> + <kbd>3</kbd> | 音声ソース: **システム ＋ マイク（会議推奨）** |
| <kbd>⌘</kbd> + <kbd>,</kbd> | **設定画面を開く** |
| <kbd>⌘</kbd> + <kbd>P</kbd> | ウィンドウ最前面固定トグル（実行中は一時停止） |
| <kbd>⌘</kbd> + <kbd>M</kbd> | ウィンドウの最小化 |
| <kbd>?</kbd> | キーボードショートカット一覧の表示 |
| <kbd>Esc</kbd> | モーダルを閉じる / 設定を終了して戻る |

---

## ステップ 7 — 保存済み会議の確認、AI議事録 ＆ 音声ログ

<kbd>⌘</kbd> + <kbd>O</kbd> を押すか、**📚 Meeting Logs** をクリックして3タブ構成のセッション管理画面を開きます：

![AI会議議事録](user_manual/session_minutes_ja.png)

- **AI会議議事録**: 会議の背景、決定事項、アクションアイテムをAIが日本語で自動構造化。
- **バイリンガル会議ログ**: 発言ごとの二言語対訳表示、クリックした発言箇所への音声シーク、Re-transcriptおよび `.srt` / `.txt` 出力に対応：

![会議ログと音声プレイヤー同期](user_manual/session_logs.png)

---

## ℹ️ 開発者 ＆ テクニカルサポート

- **開発者**: **Terry**
- **サポートメール**: [tuyennq1001@gmail.com](mailto:tuyennq1001@gmail.com)
- **GitHub リポジトリ**: [https://github.com/tuyennq1001/meetminder](https://github.com/tuyennq1001/meetminder)
- **バグ報告・フィードバック**: [https://github.com/tuyennq1001/meetminder/issues](https://github.com/tuyennq1001/meetminder/issues)
