---
paths:
  - "src/**/*.ts"
  - "!src/**/*.test.ts"
---

# ログルール

詳細な戦略は `docs/guides/logging-rules.md` を参照。

## 必須ルール

- `src/log.ts` の `log` オブジェクトを使う（`Logger.log` や `console.*` の直接呼び出しは禁止）
- ログのフォーマット: `[モジュール名] メッセージ | {"key":"value"}`

## ログレベル

- `log.info`: 正常フローの入口・出口のみ
- `log.warn`: 処理継続可能な異常
- `log.error`: 処理失敗。原因特定に必要な情報（ステップ名・`err`・関連 ID）をすべて含める

## 開発用ログ

一時的なステップ通過ログを追加する場合は必ず `// TODO(dev-log): 本番運用時に削除` を直前に付ける。
