# GAS API 制約

GAS（Google Apps Script）はNode.js環境ではない。以下の制約を守ること。

## 禁止されているAPI

| 禁止 | 代替 |
|---|---|
| `fetch()` | `UrlFetchApp.fetch()` |
| `process.env.*` | `PropertiesService.getScriptProperties().getProperty()` ※ただし `src/config.ts` 経由で取得すること |
| `console.log/warn/error` | `src/log.ts` の `log` オブジェクト |
| `Logger.log()` | `src/log.ts` の `log` オブジェクト |
| `require()` / 動的 `import()` | 静的 `import` のみ（Rollupでバンドルされる） |
| `fs`, `path`, `os` 等のNode.jsビルトイン | 使用不可 |
| `Buffer`, `process`, `__dirname`, `__filename` | 使用不可 |

## 使用可能なGAS固有グローバルAPI

| API | 用途 |
|---|---|
| `UrlFetchApp.fetch(url, options)` | HTTPリクエスト |
| `PropertiesService.getScriptProperties()` | スクリプトプロパティの読み取り |
| `ContentService.createTextOutput()` | HTTPレスポンスの生成 |

## 注意点

- GASのタイムアウト上限は **6分**。ループや多数のAPIコールが連続する場合は分割を検討する。
- TypeScriptのビルドはNode.js環境で行うが、実行環境はGASであることを常に意識する。
