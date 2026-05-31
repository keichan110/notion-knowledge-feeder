---
paths:
  - "src/**/*.test.ts"
---

# テスト規約

詳細は `docs/testing-guideline.md` を参照。

## 必須ルール

- テストフレームワークは Vitest を使う
- テストファイルはソースと同階層に `<モジュール名>.test.ts` で配置する
- `describe` でモジュール単位にグループ化し、`it` の説明文は日本語で書く
- GAS グローバル API のモックは `src/test/setup.ts` で管理する（`vi.stubGlobal()` を使う）
- TDD で進める：テストを先に書いて失敗を確認してから実装する
