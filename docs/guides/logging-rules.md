# ログ戦略

## 基本方針

- `src/log.ts` の `log` オブジェクトを使う（`Logger.log` や `console.*` の直接呼び出しは禁止）
- Cloud Logging に severity 付きで記録されるよう `console.*` をラップしている
- 出力フォーマット: `[モジュール名] メッセージ | {"key":"value"}`

## ログレベルの使い分け

| レベル | 用途 |
|---|---|
| `log.info` | 正常フローの入口・出口。何を処理して成功したかが分かる粒度に留める |
| `log.warn` | 処理は継続できるが注意が必要な状態 |
| `log.error` | 処理が失敗した場合。原因特定に必要な情報をすべて含める |

## 永続ログ（本番でも残す）

エントリポイントの受付・完了と、すべての ERROR ログは本番でも必須。

| 関数 | タイミング | レベル | 含める情報 |
|---|---|---|---|
| `doPost` | URL 受付成功 | INFO | `url` |
| `doPost` | 重複 URL | ERROR | `err`, `url` |
| `doPost` | Notion 書き込み失敗 | ERROR | `err`, `url` |
| `processTrendingQiita` | フィード取得失敗 | ERROR | `err` |
| `processTrendingQiita` | 重複 URL スキップ | WARN | `url`（バルク登録では重複が想定されるためエラーではない） |
| `processTrendingQiita` | 登録失敗 | ERROR | `err`, `url` |
| `processTrendingZenn` | フィード取得失敗 | ERROR | `err` |
| `processTrendingZenn` | 重複 URL スキップ | WARN | `url`（バルク登録では重複が想定されるためエラーではない） |
| `processTrendingZenn` | 登録失敗 | ERROR | `err`, `url` |
| `processPendingArticles` | 処理開始 | INFO | `pageId`, `url` |
| `processPendingArticles` | 処理完了 | INFO | `pageId` |
| `processPendingArticles` | 失敗 | ERROR | ステップ名（`fetch`/`gemini`/`notion`）, `err`, `pageId`, `url` |

## 開発用ログ（本番運用前に削除）

動作検証のためにステップ通過ログを出す場合は、必ず直前に以下のコメントを付ける。

```ts
// TODO(dev-log): 本番運用時に削除
log.info('processPendingArticles', 'jina ok', { chars: articleText.length });
```

本番化の前に以下のコマンドで対象行を一括確認・削除する。

```sh
grep -rn "TODO(dev-log)" src/
```

### 現在の開発用ログ一覧

| ファイル | 関数 | ログ内容 |
|---|---|---|
| `src/index.ts` | `processPendingArticles` | jina ok（取得文字数）, gemini ok（title + confidence）, notion updated（pageId） |
| `src/jina.ts` | `fetchArticleContent` | fetched（取得文字数） |
| `src/gemini.ts` | `callGeminiAPI` | success（model + title + confidence） |
