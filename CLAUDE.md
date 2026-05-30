# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

iOSショートカットから送られたURLをGemini APIで要約し、NotionのナレッジDBに自動保存するGoogle Apps Script（GAS）プロジェクト。TypeScriptで開発し、Rollupでバンドルしてclaspでデプロイする。


## 必須ルール

- 実装コードを修正したら、typecheck、lint、testを実行し、失敗しないことを**必ず確認**すること
- pnpm-lock.yamlは直接編集しないこと
- claspコマンドは実行しないこと

## コマンド

```sh
pnpm install          # 依存関係のインストール
pnpm build            # TypeScript → dist/ にバンドル（appsscript.jsonもコピー）
pnpm typecheck        # 型チェックのみ（tsc --noEmit）
pnpm lint             # Biome lint
pnpm check            # Biome lint + format（--writeで自動修正）
pnpm test             # Vitest テスト実行
pnpm test:watch       # ウォッチモードでテスト
```

単一テストファイルの実行:
```sh
pnpm exec vitest run src/gemini.test.ts
```

## アーキテクチャ

```
iOSショートカット
    ↓ POST /exec (JSON: {token, url})
doPost() [index.ts]
    ↓
fetchArticleContent() [jina.ts]   ← https://r.jina.ai/{url} で本文取得
    ↓
callGeminiAPI() [gemini.ts]       ← Gemini API で要約・構造化（GeminiResult型）
    ↓
writeToNotion() [notion.ts]       ← Notion API v2022-06-28 でページ作成
```

### 重要な設計上の制約

**GAS環境**: `UrlFetchApp`・`PropertiesService`・`ContentService` はGAS固有のグローバルAPIで、Node.jsには存在しない。テストでは `src/test/setup.ts` でviのグローバルスタブとして注入している。

**バンドル方式**: GASはES modules非対応のため、Rollupで単一ファイル（`dist/bundle.js`）に結合してESM形式で出力する。`disableEntryPointTreeShaking`プラグインによりエントリポイントの関数が除去されないよう保護し、`export {}` 行も除去している。`doPost`・`testRun`等のGASエントリポイント関数はglobalに露出する必要があるため、`biome-ignore`コメントで`noUnusedVariables`を抑制している。

**設定値**: すべてGASのスクリプトプロパティで管理（`SECRET_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `NOTION_ACCESS_TOKEN`, `NOTION_DB_ID`）。`.clasp.json` はgit管理外。

### モジュール構成

| ファイル | 役割 |
|---|---|
| `src/index.ts` | GASエントリポイント。`doPost`（本番）と各フェーズのテスト関数を定義 |
| `src/config.ts` | スクリプトプロパティ読み込みと `Config` 型定義 |
| `src/jina.ts` | Jina AI Reader APIで記事本文取得 |
| `src/gemini.ts` | Gemini APIで記事を要約・構造化し `GeminiResult` を返す |
| `src/notion.ts` | `GeminiResult` をNotionページとして書き込む |
| `src/utils.ts` | `createResponse()`（GASレスポンス生成） |

## コードスタイル

- フォーマット・lintはBiome（`biome.json`の設定に従う）
