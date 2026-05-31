# テストガイドライン

このドキュメントはプロジェクトのテスト規約をまとめたものです。

---

## テストフレームワーク

[Vitest](https://vitest.dev/) を使用します。

```sh
pnpm test               # 全テスト実行
pnpm test:watch         # ウォッチモード
pnpm exec vitest run src/gemini.test.ts  # 単一ファイル実行
```

---

## ファイル配置

- テストファイルはソースファイルと同じディレクトリに置く
- ファイル名は `<モジュール名>.test.ts`

```
src/
  gemini.ts
  gemini.test.ts   # ← 同階層に配置
```

---

## テストの書き方

```ts
import { describe, expect, it, vi } from 'vitest';
import { callGeminiAPI } from './gemini';

describe('callGeminiAPI', () => {
  it('Gemini のレスポンスをパースして返す', () => {
    // ...
  });
});
```

- `describe` でモジュール（関数）単位にグループ化する
- `it` の説明文は**日本語**で書く
- `describe` の名前はテスト対象の関数名・クラス名にする

---

## GAS グローバル API のモック

GAS 固有のグローバル API（`UrlFetchApp`・`PropertiesService`・`ContentService`・`Utilities`・`Session`）は `src/test/setup.ts` で `vi.stubGlobal()` によりスタブが注入済みです。

各テストでは `vi.mocked()` を使って戻り値を上書きします。

```ts
vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);
```

- スタブの追加・変更が必要な場合は `src/test/setup.ts` を編集する
- テストごとに `vi.clearAllMocks()` は不要（setup.ts のデフォルト値にリセットされる）

---

## TDD の進め方

1. 期待される入出力に基づきテストを先に書く
2. テストを実行して**失敗を確認**する
3. テストが正しいことを確認したらコミットする
4. テストをパスさせる実装を書く
5. すべてのテストが通過するまで繰り返す（実装中はテストを変更しない）
