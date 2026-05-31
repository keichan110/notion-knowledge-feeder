# GASエントリポイントの設計

GASから直接呼び出される関数（エントリポイント）には特有の設計制約がある。

## エントリポイント関数の要件

GASはバンドル後の `dist/bundle.js` をグローバルスコープで実行する。
エントリポイント関数はglobalに露出している必要があるため、`export` を付けること。

```ts
// ✅ 正しい: export を付ける
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput { ... }
export function processPendingArticles(): void { ... }

// ❌ 誤り: export がないとバンドル後にグローバルに露出されない
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput { ... }
```

## Biomeの警告抑制

Biomeは未使用の `export` 変数を警告するが、GASエントリポイントは外部（GAS）から呼ばれるため使用中とみなせない。
`biome-ignore` コメントで抑制すること。

```ts
// biome-ignore lint/correctness/noUnusedVariables: GAS entrypoint
export function doPost(e: GoogleAppsScript.Events.DoPost) { ... }
```

## バンドル設定（Rollup）

- バンドラーは `rollup.config.ts` で設定されており、`dist/bundle.js` に単一ファイルとして出力する
- `disableEntryPointTreeShaking` プラグインによりエントリポイント関数が除去されないよう保護されている
- バンドル後の出力から `export {}` 行が除去されていること（GASはESM非対応のため）

これらの設定は既に `rollup.config.ts` に組み込まれているため、エントリポイント追加時に変更が必要かどうかを確認すること。
