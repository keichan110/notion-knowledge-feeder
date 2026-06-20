# ADR-0001: Capability層とPipeline層への2層アーキテクチャ

- Status: Accepted
- Date: 2026-06-20

## Context

元の構成は「URL → Jina → Gemini → Notion」という単一パイプラインで、次の歪みがあった。

- `gemini.ts` が「記事要約」というドメインを知りすぎており（プロンプト・`GeminiResult` 構造を内包）、薄いクライアントになっていない。
- 「キュー＝Notionレコード＝ストレージ」が密結合し、出口がNotion固定という前提に縛られていた。

ここに次の新機能を載せたい。

- **Gmailダイジェスト**: 前日のメール（約30件）をまとめて要約し **Slack** へ通知（出口がNotionではない）。
- **週次Notionサマリー**: Notionの蓄積を週次でまとめ **Slack** へ通知（Notionが入力側になる）。

出口・入口がNotion固定でなくなるため、機能を載せられる基盤への再構成が必要になった。用語の定義は [`CONTEXT.md`](../../CONTEXT.md) を参照。

## Decision

コードを **Capability層** と **Pipeline層** の2層に分離する。

1. **Capability層** — 外部システムへの薄い・ドメイン非依存クライアント（`gemini` / `jina` / `notion` / `gmail` / `slack`）。「どう叩くか」のみを知る。プロンプト・出力スキーマ・業務判断は持たない。
2. **Pipeline層** — 機能（ユースケース）単位。Capabilityを `Source → Transform → Sink` に配線し、ドメインロジックを所有する。

具体方針:

- `gemini` Capability は `prompt` ＋ 任意の `responseSchema`（Gemini APIのJSONモード）を受け、応答を返すだけにする。ドメイン型 `GeminiResult` とプロンプトは `article-ingest` Pipeline へ移す。
- `notion` Capability は汎用CRUD（createPage / queryDatabase / updatePage）に徹する。「処理待ち」ステータスのキュー概念と `HAS_PENDING` フラグは `article-ingest` Pipeline 固有として切り出す。
- **キューは全Pipeline共通の背骨にしない**。キューが要るのは「速い応答が必要な同期inbound（`doPost`）× 遅い処理」の組み合わせのときだけで、現状 `article-ingest` のみ。ダイジェスト型（Gmail・週次）は時間駆動で同期完結し、キューを使わない。
- 物理配置: 横断インフラは `src/lib/`、Capabilityは `src/capabilities/`、機能は `src/pipelines/<feature>/`。GASエントリポイント（`src/index.ts`）はPipelineを起動する薄い入口に徹する。

## Consequences

- 新機能の追加が「どのCapabilityを、逐次型／ダイジェスト型のどちらのPipelineで繋ぐか」に単純化される。Capabilityは複数Pipelineから再利用できる。
- `notion.ts` から「処理待ち」ドメインが消え、出口Notion固定の前提が外れる。Slack等を一級の出口として扱える。
- 既存 `article-ingest` を新構造へ再配置する移行コストが発生する。
- Pipeline間で共有されるドメインロジック（例: Slack向けダイジェスト整形）の置き場は未決。実需が出た時点で別途決定する（Capabilityには寄せない、という原則のみ確定）。
