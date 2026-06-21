# CONTEXT

このプロジェクトの**ドメイン用語集**。コード・Issue・ADR・設計会話で概念を指すときは、ここで定義した語をそのまま使う。

これは仕様書でも実装ガイドでもない。用語の意味を一意に固定するためだけのもの. 実装の詳細は各モジュールと `docs/adr/` を参照。

## アーキテクチャの語彙

### Capability（ケイパビリティ）

外部システムへの**薄い・ドメイン非依存のクライアント**。「そのシステムをどう叩くか」だけを知り、「何のために叩くか（業務上の意味）」は知らない。

- 例: `gemini`（プロンプトを渡してテキスト/構造化結果を得る）、`jina`（URLから本文を得る）、`notion`（ページの読み書き）、`gmail`（メールを読む）、`slack`（メッセージを投稿する）。
- 原則: **プロンプト文・出力スキーマ・業務的なパース・分岐はCapabilityに置かない**。それらは Pipeline が所有する。
- 1つのCapabilityは Source・Sink・Transform の役割を複数兼ねうる（例: `notion` は Source 兼 Sink）。

### Pipeline（パイプライン）

1つの**機能（ユースケース）**の単位。**Capabilityを組み合わせて `Source → Transform → Sink` を配線し、ドメインロジック（プロンプト・出力スキーマ・判断）を所有する**層。

Capability と Pipeline は**直交する軸**: Capabilityは「どう外部を叩くか」で外部システム別に縦に切り、Pipelineは「何を実現するか」で機能別に横に切る。多対多（1 Pipelineは複数Capabilityを使い、1 Capabilityは複数Pipelineから使われる）。

1つのPipelineは**複数のエントリポイント／実行にまたがりうる**。例: article-ingest は「受付（`doPost`）」と「処理（時間駆動）」の2実行に分かれるが、キューで分割された1機能であり 1 Pipeline と数える。

現在のPipeline:

- **article-ingest** — URL（iOSショートカット／トレンドフィード）を受け、本文要約をNotionに1件ずつ保存する。**逐次型**。
- **gmail-digest** — 前日ウィンドウ内に届いた `Newsletter` ラベルのメールを、親メッセージ＋スレッド返信（Block Kit・10件単位）のSlackダイジェストにする。**ダイジェスト型**（設計確定。ADR-0002・0003）。
- **gmail-label-cleanup** — 受信トレイ外（アーカイブ済み）のメールから運用ラベル（`action`/`pending`）を外す。**メンテナンス型**（設計確定・未実装。ADR-0002）。
- **weekly-notion-summary** — Notionに溜まった記事を週次でまとめ、Slackへ通知する。**ダイジェスト型**（構想中）。

### Source / Sink / Transform

Pipeline内での Capability の**役割**。

- **Source** — 処理対象の素材を取り出す入力（例: Gmailの受信メール、Notionの蓄積データ、トレンドフィード）。
- **Transform** — 素材を加工する（例: Jinaの本文抽出、Geminiの要約・構造化）。
- **Sink** — 結果を出す出力（例: Notionへの保存、Slackへの通知）。

### 逐次型パイプライン（per-item）

素材を**1件ずつ独立に**処理し、1件ずつSinkへ出す型。件数×レイテンシが大きく1実行で終わらないため、**キューを使う**。現在は article-ingest のみ。

### ダイジェスト型パイプライン（digest）

複数件の素材を**まとめて1回**加工する型（例: 30件のメール → Gemini 1回）。同期完結し**キューは使わない**。gmail-digest・weekly-notion-summary が該当。Sinkへの送信は表示の都合で**複数回に分かれることがある**（gmail-digest は親メッセージ＋スレッド返信。ADR-0003）。

### メンテナンス型パイプライン（maintenance）

外部システムの状態を**整える**ことだけを目的とし、Slack等の外部Sinkへ通知を出さない型。SourceとSinkが**同一Capability**になりうる（例: Gmailを読んでGmailのラベルを外す）。時間駆動で同期完結し、**キューは使わない**。gmail-label-cleanup が該当。

### 前日ウィンドウ

ダイジェスト型がGmailを集計する**対象期間**。トリガーは当日7時台に動き、対象は**前日7:00〜当日7:00（JST）の24時間**（前日7:00起点のローリングウィンドウ）。Gmailの `after:`/`before:` に **epoch秒**を渡して時刻境界を表現する。発火しうる最も早い7:00を境界に固定することで、隣接する実行どうしが隙間なく連続し取りこぼさない（ADR-0004）。対象が0件でも「0件」をSinkへ通知する（その場合Geminiは呼ばない）。

### キュー（Queue）／仮登録（Pending）

「速い応答が必要な同期inboundリクエスト」と「遅い処理」を**分離するための非同期バッファ**。inbound（`doPost`）は素材を「処理待ち」状態で**仮登録**して即「受け付けた」と返し、実際の Transform→Sink は後続の時間駆動トリガーが拾って行う。

- キューが必要なのは「**速い応答を求める同期inbound × 遅い処理**」の組み合わせのときだけ。時間駆動で起動するPipeline（②③）には不要。
- 現状のキュー実体はNotionレコード（status「処理待ち」）＋ `HAS_PENDING` フラグ。これは article-ingest 固有の都合であり、全Pipeline共通の背骨ではない。

### エントリポイント

GASがアプリを起動する関数（`doPost`、時間駆動function）。**Pipelineを起動するだけの薄い入口**に徹し、ドメインロジックを持たない。
