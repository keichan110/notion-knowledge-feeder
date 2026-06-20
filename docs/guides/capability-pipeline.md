# Capability層 / Pipeline層の設計

このプロジェクトは **Capability層** と **Pipeline層** の2層アーキテクチャを採る。用語の定義は [`CONTEXT.md`](../../CONTEXT.md)、決定の背景は [`docs/adr/0001-capability-pipeline-layers.md`](../adr/0001-capability-pipeline-layers.md) を参照。このドキュメントは**コードを書くときのルール**をまとめる。

---

## 一行の判断基準

どちらの層に書くか迷ったら「**それはドメイン知識か？**」で振り分ける。

| 性質 | 置き場 |
|---|---|
| 外部システムの叩き方（HTTP・認証・レスポンス形式・リトライ） | **Capability** |
| 何のために・何を（プロンプト・業務判断・出力の意味・キュー） | **Pipeline** |

---

## Capability層のルール

配置は `src/capabilities/<name>.ts`。外部システムへの**薄い・ドメイン非依存クライアント**。

- **1 Capability = 1 外部システム**（例: `gemini` / `jina` / `notion` / 将来の `gmail` / `slack`）。
- **ドメイン知識を持たない。** プロンプト文・出力スキーマ（ドメインの形）・業務的な分岐・ドメイン型（例: `GeminiResult`）を置かない。
- **設定を自分で読まない。** `PropertiesService` を直接触らず、必要な値（APIキー・トークン・モデル名・DB ID 等）は**引数で受け取る**。薄さ・テスト容易性・再利用性を保つため（設定の読み込みは [`gas-script-properties.md`](./gas-script-properties.md) を参照）。
- **特定機能に依存しない。** 複数Pipelineから再利用される前提で、ある機能専用の引数・分岐を持ち込まない。
- API/プロトコル水準の関心（HTTP呼び出し、リトライ・バックオフ、ステータス処理、APIレベルのレスポンス整形）は**ここに置いてよい**。

```ts
// ✅ gemini Capability: API水準だけ。prompt と responseSchema は呼び出し側から受け取る
export function generateContent(args: {
  model: GeminiModel;
  apiKey: GeminiApiKey;
  systemInstruction: string;
  userContent: string;
  responseSchema?: object;
}): string {
  /* HTTP呼び出し・503リトライ・応答テキスト抽出のみ */
}

// ❌ 要約プロンプト・GeminiResult・CATEGORIES などドメインを内包しない
```

例:
- `gemini` … `prompt`・`responseSchema?`・`model`・`apiKey` を受け、応答テキストを返す。`GeminiResult`（ドメインの形）は持たない。
- `notion` … 汎用CRUD（ページ作成・データソース照会・ページ更新）。「処理待ち」status・重複検知などのドメインは持たない。

---

## Pipeline層のルール

配置は `src/pipelines/<feature>/`。**1機能（ユースケース）= 1ディレクトリ**。`Source → Transform → Sink` を配線し、ドメインロジックを所有する。

- **ドメインの所有物をここに置く。** プロンプト・出力スキーマ・ドメイン型・業務判断、そのPipeline固有の Source（`sources/`）、キュー等。
- **Capabilityへ設定を注入する責務を持つ。** 必要な config スライスを読み、Capabilityの引数として渡す。
- **`CONTEXT.md` の用語を使う**（Source / Transform / Sink / 逐次型 / ダイジェスト型）。
- **キューは限定的に使う。** キューを使うのは「速い応答が必要な同期inbound × 遅い処理」の**逐次型**のときだけ。ダイジェスト型（複数件を集約して1回処理・1回出力）は同期完結し、キューを使わない。キューはそのPipeline固有のものとして実装し、共通基盤化しない。

```
src/pipelines/article-ingest/
  index.ts      ← Source→Transform→Sink の配線（オーケストレーション）
  result.ts     ← GeminiResult 型・responseSchema（ドメイン）
  prompt.ts     ← 要約プロンプト（ドメイン）
  pending.ts    ← 「処理待ち」キュー（このPipeline固有）
  sources/      ← このPipeline固有の Source（トレンド等）
```

---

## エントリポイント

`src/index.ts` の GAS エントリポイント（`doPost`・時間駆動function）は **Pipeline を起動するだけの薄い入口**。ドメインロジックを持たない。エントリポイント固有の制約（`export`・`biome-ignore`・バンドル）は [`gas-entrypoint-design.md`](./gas-entrypoint-design.md) を参照。

---

## 依存方向

```
エントリポイント ──→ Pipeline ──→ Capability
                        │            │
                        └────────────┴──→ lib（横断: config / log / utils）
```

- **Capability は Pipeline に依存してはいけない**（逆流禁止）。Capability は他のCapabilityやドメインを知らない。
- **Pipeline 同士は依存しない。** 共有ロジックが生まれても **Capability には寄せない**（薄さを壊すため）。Pipeline間共有として別に切り出す。
- `lib/` は横断インフラで、どの層からでも使ってよい。

---

## テスト

継ぎ目（seam）に沿わせる（詳細は [`testing-guideline.md`](./testing-guideline.md)）。

- **Capability** … 外部境界（GASグローバルのモック越し）でテストし、API水準の挙動（HTTP・リトライ・パース）を検証する。
- **Pipeline** … Capabilityをモックし、観測可能な振る舞い（レスポンス・呼び出し引数・status遷移）を検証する。ドメイン寄りのテスト（プロンプト・スキーマ・キュー）はここに置く。
