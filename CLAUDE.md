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

### フェーズ1：URL仮登録

```
【手動登録】
iOSショートカット
    ↓ POST /exec (JSON: {token, url})
doPost() [index.ts]
    ↓
registerPendingUrl() [index.ts]   ← クエリ文字列除去・重複チェック
    ↓
createPendingRecord() [notion.ts] ← Notion API にステータス「処理中」で仮登録

【トレンド自動登録】（GASタイムトリガー・日次・7〜8時）
processTrendingQiita() / processTrendingZenn() [index.ts]
    ↓
fetchQiitaTrendUrls() / fetchZennTrendUrls() [trend/]  ← Atom/RSSフィードから上位3件取得
    ↓
registerPendingUrl() [index.ts]   ← 各URLを仮登録（重複はスキップ）
```

### フェーズ2：記事処理

```
（GASタイムトリガー・10分間隔）
processPendingArticles() [index.ts]
    ↓ HAS_PENDINGフラグ確認（なければ即終了）
queryPendingRecord() [notion.ts]  ← ステータス「処理中」のレコードを1件取得
    ↓
fetchArticleContent() [jina.ts]   ← https://r.jina.ai/{url} で本文取得
    ↓
callGeminiAPI() [gemini.ts]       ← Gemini API で要約・構造化（GeminiResult型）
    ↓
updateRecord() [notion.ts]        ← Notion API でレコードをステータス「完了」に更新
```

### 重要な設計上の制約

**GAS環境**: `UrlFetchApp`・`PropertiesService`・`ContentService` はGAS固有のグローバルAPIで、Node.jsには存在しない。

**バンドル方式**: GASはES modules非対応のため、Rollupで単一ファイル（`dist/bundle.js`）に結合してESM形式で出力する。`disableEntryPointTreeShaking`プラグインによりエントリポイントの関数が除去されないよう保護し、`export {}` 行も除去している。`doPost`・`testRun`等のGASエントリポイント関数はglobalに露出する必要があるため、`biome-ignore`コメントで`noUnusedVariables`を抑制している。

**設定値**: すべてGASのスクリプトプロパティで管理（`SECRET_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `NOTION_ACCESS_TOKEN`, `NOTION_DB_ID`, `SLACK_BOT_TOKEN`, `SLACK_NOTIFY_CHANNEL_ID`, `SLACK_ERROR_CHANNEL_ID`, `DLP_PROJECT_ID`）。`.clasp.json` はgit管理外。

### モジュール構成

| ファイル | 役割 |
|---|---|
| `src/index.ts` | GASエントリポイント。`doPost`（本番）と各フェーズのテスト関数を定義 |
| `src/config.ts` | スクリプトプロパティ読み込みと `Config` 型定義 |
| `src/jina.ts` | Jina AI Reader APIで記事本文取得 |
| `src/gemini.ts` | Gemini APIで記事を要約・構造化し `GeminiResult` を返す |
| `src/notion.ts` | `GeminiResult` をNotionページとして書き込む |
| `src/utils.ts` | `createResponse()`（GASレスポンス生成） |
| `src/lib/notify.ts` | Slackエラー専用チャンネルへの通知基盤（error/warn の2段） |
| `src/trend/index.ts` | トレンドモジュールの再エクスポート |
| `src/trend/qiita.ts` | Qiita人気記事AtomフィードからトレンドURLリストを取得（上位3件） |
| `src/trend/zenn.ts` | ZennトレンドRSSフィードからトレンドURLリストを取得（上位3件） |
