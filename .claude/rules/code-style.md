---
paths:
  - "src/**/*"
---

# コードスタイルガイドライン

詳細は `docs/guides/code-guideline.md` を参照。

## 必須ルール

- フォーマット・lint は Biome を使う（`pnpm check` で自動修正）
- `export` する型・関数はファイルの先頭、内部ヘルパーは末尾に置く
- すべての `export` 関数に TSDoc コメントを付ける（`@param`・`@returns` は必須）
