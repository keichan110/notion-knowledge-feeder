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
// 1. 定数（内部・外部問わず）を import の直後に置く
const MAX_RETRIES = 3;
export const DEFAULT_TIMEOUT = 5000;

// 2. export する関数・型（public API）
export type MyType = { ... };
export function publicFunction() { ... }

// 3. 内部ヘルパー関数はファイルの末尾に置く
function internalHelper() { ... }
```

- 定数（`export` の有無を問わず）はファイルの**先頭**（import の直後）にまとめる
  - どの値をこのモジュールが使用しているかが一目でわかるようにするため
- `export` する型・関数はその次にまとめる
- 外部から呼ばれない内部ヘルパー関数はファイルの**末尾**に置く

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

## エラーハンドリング

- **内部ヘルパー（非 export 関数）**: エラーをキャッチせず、そのまま `throw` する。ロギングも行わない。
- **公開関数（export 関数）**: 内部ヘルパーが投げたエラーを `catch` し、ログ出力とレスポンス生成の責務を担う。
- 「エラーではない非正常系」（例: バルク登録での重複スキップ）は公開関数側で `instanceof` により分岐し、適切なログレベル（`warn` など）で記録する。

```ts
// 内部ヘルパー: throw するだけ、ログなし
function registerPendingUrl(url: string): void {
  createPendingRecord(url, dbId, token); // DuplicateUrlError はそのまま伝播
}

// 公開関数: catch してログ・レスポンスを決定
export function doPost(e): TextOutput {
  try {
    registerPendingUrl(url);
  } catch (err) {
    if (err instanceof DuplicateUrlError) {
      log.error('doPost', 'duplicate', err, { url });
      return createResponse(false, 'This URL has already been registered');
    }
    log.error('doPost', 'notion write failed', err, { url });
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }
}
```

## ログ

[`docs/guides/logging-rules.md`](./logging-rules.md) を参照。
