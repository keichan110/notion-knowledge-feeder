# ADR-0002: Gmail由来の2機能（ラベル整理・Newsletterダイジェスト）の設計

- Status: Accepted
- Date: 2026-06-21

## Context

ADR-0001 で Capability層 / Pipeline層を分離し、`gmail` / `slack` Capability を語彙として先取りした。そこへ Gmail を起点とする2機能を載せる。

1. **ラベル整理**: 受信トレイ外（アーカイブ済み）のメールに残った運用ラベル `action` / `pending` を自動で外す。通知は出さない「お掃除」。
2. **Newsletterダイジェスト**: 前日に届いた `Newsletter` ラベルのメールをまとめてSlackへ通知する。段階リリースし、まず素のメール情報（2-1）、次にGemini要約（2-2）。

この2機能は目的・実行形態・使うCapabilityが異なるため、それぞれの位置づけと挙動を確定する。用語の定義は [`CONTEXT.md`](../../CONTEXT.md) を参照。

## Decision

### 共通

- **Capability の追加**: `gmail`（読み取り＋ラベル付け外し）、`slack`（メッセージ投稿）。いずれも薄いクライアントに徹し、検索クエリ・ラベル名・メッセージ整形などの業務判断はPipelineが所有する。
- **Slack送信は Web API（`chat.postMessage` / Botトークン）**。`slack` Capability は `postMessage(channel, text/blocks)` を提供する。設定はスクリプトプロパティ `SLACK_BOT_TOKEN` ＋ `SLACK_CHANNEL_ID`。
- 両機能とも**時間駆動で同期完結**し、キューは使わない。

### 機能1: gmail-label-cleanup（メンテナンス型）

- 独立した Pipeline（`src/pipelines/gmail-label-cleanup/`）。Gmailが **Source 兼 Sink** で、外部Sink（Slack等）への通知は持たない。
- **対象はアーカイブ済みのみ**（INBOXラベルが外れたメール）。ゴミ箱・迷惑メールは対象外（Gmail検索のデフォルト挙動）。検索は `label:action -in:inbox` / `label:pending -in:inbox` 相当。
- 対象ラベル（`action` / `pending`）はスクリプトプロパティで管理し、ハードコードしない。
- 時間駆動で日次実行。

### 機能2: gmail-digest（ダイジェスト型）

- 独立した Pipeline（`src/pipelines/gmail-digest/`）。当日7時台のトリガーで起動。
- 対象は**前日ウィンドウ**（前日の暦日・JST 0:00〜23:59）に届いた `Newsletter` ラベルのメール。期間指定は Gmail の日付検索の粒度（暦日）に合わせ、時刻での絞り込みはしない（実装をシンプルに保つ）。
- 出力は**1通のSlackメッセージに集約**（ダイジェスト型の原則「1回Sinkへ出す」）。メール毎を blocks のセクションとして並べる。本文は `getPlainBody()` でプレーン化して使う。
- **0件のときもSlackへ「0件」を通知**する（ジョブの生存確認）。ただしその場合 Gemini は呼ばない。

段階リリース:

- **2-1（先行）**: 各セクションに **件名・送信者・本文冒頭（200字程度）** を載せる。Geminiは使わない。
- **2-2（後続）**: 前日ウィンドウのメール群を **Geminiで1回だけ横断要約**し、ダイジェスト先頭に「まとめ」段落として置く。その下に**件名・送信者の一覧**を残す（どのNewsletterが届いたか追えるようにする）。CONTEXT のダイジェスト型定義「まとめて1回加工 → Gemini 1回 → Slack 1通」にそのまま整合する。

### スクリプトプロパティ（追加分）

| キー | 用途 |
|---|---|
| `SLACK_BOT_TOKEN` | Slack Web API のBotトークン |
| `SLACK_CHANNEL_ID` | 投稿先チャンネル |
| Newsletterラベル名 / 運用ラベル名 | ラベル文字列の設定化（ハードコード回避） |

## Consequences

- CONTEXT.md に「メンテナンス型パイプライン」「前日ウィンドウ」を追加した。Sinkを持たない側面操作（Gmailラベル整理）が Pipeline 語彙に収まる。
- `gmail` / `slack` Capability が実体化し、将来の weekly-notion-summary から `slack` を再利用できる。
- 2-1 → 2-2 でメッセージ構造が「各メールの本文冒頭」から「横断まとめ＋件名一覧」へ変わる。2-2 で個別メールの本文は通知から落ちる（要約に集約される）。
- Gmail の日付検索が暦日粒度のため、トリガー時刻（7時台）と対象期間（前日暦日）はずれる。これは意図的な単純化であり、時刻精度は追わない。
- Newsletterが恒常的に多い場合、本文を1回のGemini入力にまとめる際のトークン量が課題になりうる。実需が出た時点で件数上限・本文トリム等を別途検討する。
