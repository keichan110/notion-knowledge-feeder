---
paths:
  - "src/**/*"
---

# コードスタイルガイドライン

詳細は `docs/guides/code-guideline.md` を参照。

## 必須ルール

- フォーマット・lint は Biome を使う（`pnpm check` で自動修正）
- 定数（内部・外部問わず）は import の直後に置く、`export` する型・関数はその次、内部ヘルパー関数は末尾に置く
- すべての `export` 関数に TSDoc コメントを付ける（`@param`・`@returns` は必須）
