// Default and preset meeting-minutes templates, independent of UI state.

export const DEFAULT_TEMPLATE_MINUTES_JA = `# 📋 会議議事録 (Meeting Minutes)

### 📌 基本情報
- **会議名**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加者**: {{participants}}

---

### 🎯 1. 背景と目的 (Background & Objectives)
(なぜこの会議が行われたのか、今回の主な討議の狙い・背景)

---

### 📝 2. 主な協議内容と決定事項 (Key Discussion & Decisions)
- **協議内容の要約**:
    - (要点をトピックごとに整理して箇条書きで記載)
- **決定事項 (Key Decisions)**:
    - (合意された決定内容)

---

### ✅ 3. 今後のアクションプラン (Action Items / Next Steps)
| No | タスク (Task) | 担当者 (Assignee) | 期日 (Deadline) | 備考 |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const DEFAULT_TEMPLATE_MINUTES_VI = `# 📋 BIÊN BẢN CUỘC HỌP (MEETING MINUTES)

### 📌 THÔNG TIN CHUNG
- **Tiêu đề cuộc họp**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Người tham gia**: {{participants}}

---

### 🎯 1. BỐI CẢNH & MỤC ĐÍCH (CONTEXT & OBJECTIVES)
(Bối cảnh diễn ra cuộc họp, các vấn đề cần thảo luận và mục tiêu cần đạt được)

---

### 📝 2. NỘI DUNG TÓM TẮT & CÁC ĐIỂM THỐNG NHẤT (SUMMARY & DECISIONS)
- **Tóm tắt nội dung trao đổi chính**:
    - (Các luận điểm chính được trình bày mạch lạc, dễ hiểu)
- **Các quyết định đã chốt (Key Decisions)**:
    - (Các điểm hai bên đã thống nhất)

---

### ✅ 3. VIỆC CẦN LÀM & KẾ HOẠCH TIẾP THEO (ACTION ITEMS / NEXT STEPS)
| STT | Công việc (Task) | Người phụ trách (Assignee) | Hạn chót (Deadline) | Ghi chú |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const DEFAULT_TEMPLATE_MINUTES_EN = `# 📋 MEETING MINUTES

### 📌 GENERAL INFORMATION
- **Meeting title**: {{title}}
- **Date & time**: {{date}} (Duration: approximately {{duration}} minutes)
- **Participants**: {{participants}}

---

### 🎯 1. CONTEXT & OBJECTIVES
(Background of the meeting, key topics to discuss, and intended outcomes)

---

### 📝 2. SUMMARY & DECISIONS
- **Summary of the main discussion**:
    - (Organize the key points clearly by topic)
- **Key decisions**:
    - (Record the decisions agreed upon)

---

### ✅ 3. ACTION ITEMS / NEXT STEPS
| No. | Task | Assignee | Deadline | Notes |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const PRESET_TEMPLATE_TECH_JA = `# 💻 技術・アーキテクチャ検討議事録 (Technical Review)

### 📌 基本情報
- **議題**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加エンジニア**: {{participants}}

---

### 🔍 1. 課題と背景 (Problem Statement)
- **技術的課題・背景**:
  - (パフォーマンス問題、新アーキテクチャ要件、リファクタリング等の課題)
- **達成目標**:
  - (要件、SLA、制約条件)

---

### ⚙️ 2. 検討案と比較 (Options & Trade-offs)
- **案A**: (メリット・デメリット・コスト)
- **案B**: (メリット・デメリット・コスト)

---

### 🎯 3. 採択された技術方針・決定事項 (Technical Decisions)
- **決定方針**:
  - (採択理由と留意点)
- **潜在的リスクと対策**:
  - (懸念点およびバックアッププラン)

---

### 🛠 4. 実装タスク・次のステップ (Implementation Tasks)
| No | タスク (Task) | 担当者 | 期日 | 備考 / PR |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const PRESET_TEMPLATE_TECH_VI = `# 💻 BIÊN BẢN HỌP KỸ THUẬT & KIẾN TRÚC (TECHNICAL SYNC)

### 📌 THÔNG TIN CHUNG
- **Chủ đề kỹ thuật**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Kỹ sư / Thành viên tham gia**: {{participants}}

---

### 🔍 1. VẤN ĐỀ & BỐI CẢNH KỸ THUẬT (PROBLEM STATEMENT)
- **Vấn đề / Thách thức kỹ thuật đặt ra**:
  - (Mô tả lỗi, nút thắt hiệu năng, yêu cầu kiến trúc mới hoặc công nghệ cần tích hợp)
- **Mục tiêu kỹ thuật cần đạt**:
  - (SLAs, hiệu năng, độ chịu tải, thời gian hoàn thành)

---

### ⚙️ 2. CÁC PHƯƠNG ÁN CÂN NHẮC (OPTIONS & TRADE-OFFS)
- **Phương án A**: (Ưu điểm & Nhược điểm)
- **Phương án B**: (Ưu điểm & Nhược điểm)

---

### 🎯 3. QUYẾT ĐỊNH KIẾN TRÚC & CÔNG NGHỆ (ARCHITECTURAL DECISIONS)
- **Giải pháp được chọn chốt**:
  - (Lý do chọn phương án và các lưu ý triển khai)
- **Rủi ro kỹ thuật & Giải pháp dự phòng**:
  - (Các rủi ro tiềm ẩn và kế hoạch xử lý)

---

### 🛠 4. KẾ HOẠCH TRIỂN KHAI (IMPLEMENTATION TASKS)
| STT | Nhiệm vụ kỹ thuật (Tech Task) | Người phụ trách | Hạn chót | Nhánh / PR / Repo |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const PRESET_TEMPLATE_TECH_EN = `# 💻 TECHNICAL REVIEW & ARCHITECTURE SYNC

### 📌 GENERAL INFORMATION
- **Topic**: {{title}}
- **Date & time**: {{date}} (Duration: approximately {{duration}} minutes)
- **Participants**: {{participants}}

---

### 🔍 1. PROBLEM STATEMENT & CONTEXT
- **Technical problem / context**:
  - (Performance issue, architecture requirement, refactoring need, or integration challenge)
- **Goals**:
  - (Requirements, SLA, constraints, and success criteria)

---

### ⚙️ 2. OPTIONS & TRADE-OFFS
- **Option A**: (Benefits, drawbacks, and cost)
- **Option B**: (Benefits, drawbacks, and cost)

---

### 🎯 3. TECHNICAL DECISIONS
- **Selected approach**:
  - (Reasoning and implementation considerations)
- **Technical risks & mitigations**:
  - (Potential risks and fallback plan)

---

### 🛠 4. IMPLEMENTATION TASKS
| No. | Task | Assignee | Deadline | Notes / PR |
|:---|:---|:---|:---|:---|
| 1 | ... | ... | ... | ... |
`;

export const PRESET_TEMPLATE_1ON1_JA = `# 👥 1on1ミーティング・面談記録 (1-on-1 Notes)

### 📌 基本情報
- **面談名**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **参加者**: {{participants}}

---

### 📊 1. 業務進捗と成果 (Status & Achievements)
- **良かった点・達成できた成果**:
  - (直近のポジティブな成果、貢献)
- **現在の業務状況**:
  - (進行中プロジェクトの状況)

---

### 💬 2. フィードバックと対話 (Feedback & Discussion)
- **メンバーからの共有・所感**:
  - (業務のやりがい、関心事、キャリアに関する希望など)
- **マネージャーからのフィードバック・期待**:
  - (評価点、今後の成長に向けたアドバイス)

---

### 🚧 3. 課題・ボトルネックと支援 (Blockers & Support)
- (チーム連携、ツール、リソースなどの課題と必要なサポート)

---

### 🎯 4. 次回までのアクションプラン (Action Items)
- [ ] **アクション 1**: (期日・コミット内容)
- [ ] **アクション 2**: (期日・コミット内容)
`;

export const PRESET_TEMPLATE_1ON1_VI = `# 👥 BIÊN BẢN TRAO ĐỔI 1-ON-1 & ĐÁNH GIÁ

### 📌 THÔNG TIN BUỔI GẶP
- **Chủ đề**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Thành viên tham gia**: {{participants}}

---

### 📊 1. CẬP NHẬT TÌNH HÌNH & TIẾN ĐỘ HIỆN TẠI (STATUS UPDATE)
- **Những kết quả tốt đạt được**:
  - (Những việc đã hoàn thành tốt, điểm sáng trong kỳ)
- **Tình trạng công việc đang chạy**:
  - (Tiến độ thực tế so với kế hoạch)

---

### 💬 2. PHẢN HỒI & TÂM TƯ HAI CHIỀU (FEEDBACK & INSIGHTS)
- **Chia sẻ từ nhân viên / thành viên**:
  - (Tâm tư, nguyện vọng, mức độ hài lòng hoặc khó khăn trong công việc)
- **Phản hồi & Định hướng từ Quản lý / Mentor**:
  - (Góp ý mang tính xây dựng, định hướng phát triển)

---

### 🚧 3. KHÓ KHĂN & ĐỀ XUẤT HỖ TRỢ (BLOCKERS & SUPPORT NEEDED)
- (Các rào cản về công cụ, quy trình, phối hợp team cần tháo gỡ)

---

### 🎯 4. MỤC TIÊU TIẾP THEO & HÀNH ĐỘNG CỤ THỂ (NEXT GOALS & ACTIONS)
- [ ] **Mục tiêu 1**: (Thời hạn & cam kết)
- [ ] **Mục tiêu 2**: (Thời hạn & cam kết)
`;

export const PRESET_TEMPLATE_1ON1_EN = `# 👥 1-ON-1 MEETING & DEVELOPMENT NOTES

### 📌 MEETING INFORMATION
- **Topic**: {{title}}
- **Date & time**: {{date}} (Duration: approximately {{duration}} minutes)
- **Participants**: {{participants}}

---

### 📊 1. STATUS & ACHIEVEMENTS
- **Positive results / achievements**:
  - (Completed work and notable contributions)
- **Current work status**:
  - (Progress against plan and work in progress)

---

### 💬 2. FEEDBACK & DISCUSSION
- **Team member's perspective**:
  - (Motivation, concerns, career interests, or support needed)
- **Manager's feedback & expectations**:
  - (Constructive feedback and development direction)

---

### 🚧 3. BLOCKERS & SUPPORT NEEDED
- (Tools, processes, collaboration, or resource constraints)

---

### 🎯 4. ACTIONS BEFORE THE NEXT MEETING
- [ ] **Action 1**: (Deadline and commitment)
- [ ] **Action 2**: (Deadline and commitment)
`;

export const PRESET_TEMPLATE_PERSONAL_JA = `# 👤 個人メモ・学習まとめ (Personal Notes)

### 📌 基本情報
- **テーマ**: {{title}}
- **日時**: {{date}} (所要時間: 約 {{duration}} 分)
- **相手 / ソース**: {{participants}}

---

### 💡 1. 主な学びと気づき (Key Takeaways)
- (会話やセッションから得られた最も重要・印象的なインサイト)

---

### 📝 2. 内容の要約 (Detailed Summary)
- **トピック 1**:
  - (具体的なポイントや議論の内容)
- **トピック 2**:
  - (具体的なポイントや議論の内容)

---

### 🎯 3. 自分自身のアクションプラン (My Next Steps)
- [ ] ...
- [ ] ...

---

### 💭 4. 所感・振り返り (Reflections)
- (個人的な考察、感想、さらに深掘りしたい疑問など)
`;

export const PRESET_TEMPLATE_PERSONAL_VI = `# 👤 GHI CHÉP & TÓM TẮT CÁ NHÂN

### 📌 THÔNG TIN
- **Chủ đề**: {{title}}
- **Thời gian**: {{date}} (Thời lượng: ~{{duration}} phút)
- **Người trao đổi / Nguồn**: {{participants}}

---

### 💡 1. ĐIỂM MẤU CHỐT & BÀI HỌC RÚT RA (KEY TAKEAWAYS)
- (Những ý tưởng hay, góc nhìn mới, bài học sâu sắc nhất từ cuộc trò chuyện/buổi học)

---

### 📝 2. TÓM TẮT NỘI DUNG TRAO ĐỔI (DETAILED SUMMARY)
- **Chủ đề 1**:
  - (Chi tiết các điểm đáng chú ý)
- **Chủ đề 2**:
  - (Chi tiết các điểm đáng chú ý)

---

### 🎯 3. VIỆC CẦN LÀM CHO BẢN THÂN (MY ACTION ITEMS)
- [ ] ...
- [ ] ...

---

### 💭 4. CẢM NHẬN & SUY NGẪM THÊM (REFLECTIONS)
- (Ghi chú suy nghĩ cá nhân, cảm xúc hoặc câu hỏi cần đào sâu thêm)
`;

export const PRESET_TEMPLATE_PERSONAL_EN = `# 👤 PERSONAL NOTES & LEARNING SUMMARY

### 📌 INFORMATION
- **Topic**: {{title}}
- **Date & time**: {{date}} (Duration: approximately {{duration}} minutes)
- **Conversation partner / source**: {{participants}}

---

### 💡 1. KEY TAKEAWAYS
- (Most important ideas, insights, and lessons from the conversation or session)

---

### 📝 2. DETAILED SUMMARY
- **Topic 1**:
  - (Important details)
- **Topic 2**:
  - (Important details)

---

### 🎯 3. MY ACTION ITEMS
- [ ] ...
- [ ] ...

---

### 💭 4. REFLECTIONS
- (Personal thoughts, feelings, or questions to explore further)
`;
