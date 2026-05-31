# コーディングガイドライン

このドキュメントはプロジェクトのコーディング規約をまとめたものです。

---

## フォーマット・Lint

ツールは [Biome](https://biomejs.dev/) を使用します（`biome.json` の設定が優先）。

| 設定項目 | 値 |
|---|---|
| インデント | スペース 2 個 |
| 行幅上限 | 100 文字 |
| セミコロン | 常に付ける |
| クォート | シングルクォート |
| トレイリングカンマ | ES5 スタイル（オブジェクト・配列の末尾に付ける） |
| インポート整理 | `organizeImports: on`（自動ソート） |

```sh
pnpm lint       # lint チェック
pnpm check      # lint + format（--write で自動修正）
```

---

## ファイル構成の規約

```ts
// 1. export する関数・型（public API）をファイルの先頭にまとめる
export type MyType = { ... };
export function publicFunction() { ... }

// 2. 内部ヘルパー関数はファイルの末尾に置く
function internalHelper() { ... }
```

- `export` する型・関数はファイルの**先頭**にまとめる
- 外部から呼ばれない内部ヘルパーはファイルの**末尾**に置く

---

## TSDoc コメント

**すべての `export` 関数** に TSDoc 準拠のコメントを付けること。

```ts
/**
 * Gemini API に記事本文を送信し、要約・構造化した結果を返す。
 * @param articleText 要約対象の記事本文
 * @param geminiModel 使用する Gemini モデル名
 * @param geminiApiKey Gemini API キー
 * @returns 要約・構造化された `GeminiResult`
 * @throws Gemini API が有効な JSON を返さない場合
 */
export function callGeminiAPI(...): GeminiResult { ... }
```

- `@param`・`@returns` は必須
- エラーを投げる場合は `@throws` も記述する
- 内部ヘルパーにはコメント不要

---

## ログ

[`docs/logging-rules.md`](./logging-rules.md) を参照。
