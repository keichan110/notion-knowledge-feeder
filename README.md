# notion-knowledge-feeder

iOSショートカットから送られたURLをGemini APIで要約し、NotionのナレッジDBに自動保存するGoogle Apps Scriptプロジェクト。

## 技術スタック

| 役割 | 技術 |
|---|---|
| ランタイム | Node.js 24 / pnpm 11 |
| 言語 | TypeScript 5 |
| バンドラー | Rollup 4 |
| デプロイ | clasp 3 |
| Lint / Format | Biome |
| テスト | Vitest |
| CI/CD | GitHub Actions |

## セットアップ

GAS のスクリプトプロパティ（API キーなど）の登録手順は [docs/setup/google-app-script-setup.md](docs/setup/google-app-script-setup.md) を参照してください。

### 前提条件

- Node.js `24.16.0`（`.node-version` 参照）
- pnpm `11.4.0`

バージョン管理ツールは問いません（nvm / fnm / mise / volta など）。

```sh
pnpm install        # 依存関係のインストール
```

### clasp の認証

```sh
pnpm exec clasp login
```

### GASプロジェクトの紐付け

`.clasp.json.example` をコピーして `.clasp.json` を作成し、スクリプトIDを設定します。

```sh
cp .clasp.json.example .clasp.json
```

**既存プロジェクトを使う場合：**  
script.google.com のURLに含まれる `/d/<scriptId>/` の値を `.clasp.json` に記入します。

**新規プロジェクトを作成する場合：**

```sh
pnpm exec clasp create-script --title "notion-knowledge-feeder" --type standalone --rootDir dist
```

実行後、`.clasp.json` にスクリプトIDが自動で書き込まれます。

## 開発

```sh
pnpm build          # TypeScript → dist/ にビルド
pnpm build:watch    # ウォッチモードでビルド
pnpm typecheck      # 型チェックのみ
pnpm check          # Biome による lint + format
pnpm test           # テスト実行
```

## デプロイ

### ローカルからデプロイ

```sh
pnpm push           # ビルド → clasp push
pnpm push:force     # ビルド → clasp push --force
```

### GitHub Actions による自動デプロイ

`main` ブランチへのpushで自動的にGASへデプロイされます。

#### 初回設定

GitHub リポジトリの **Settings → Secrets and variables → Actions** に以下を登録します。

| Secret名 | 内容 | 取得方法 |
|---|---|---|
| `CLASP_REFRESH_TOKEN` | OAuthリフレッシュトークン | `clasp login` 後、`~/.clasprc.json` の `tokens.default.refresh_token` |
| `CLASP_CLIENT_ID` | OAuthクライアントID | `~/.clasprc.json` の `tokens.default.client_id` |
| `CLASP_CLIENT_SECRET` | OAuthクライアントシークレット | `~/.clasprc.json` の `tokens.default.client_secret` |
| `CLASP_SCRIPT_ID` | GASプロジェクトのスクリプトID | script.google.com のURLまたは `.clasp.json` の `scriptId` |
| `CLASP_DEPLOYMENT_ID` | ウェブアプリのデプロイID | GASエディタで初回手動デプロイ後、「デプロイを管理」から確認（詳細は [docs/setup/google-app-script-setup.md](docs/setup/google-app-script-setup.md) 参照） |

#### ワークフロー

| ワークフロー | トリガー | 内容 |
|---|---|---|
| CI | push / PR → main | typecheck + build |
| Deploy | push → main | build + clasp push + clasp deploy |

## ディレクトリ構成

```
notion-knowledge-feeder/
├── src/
│   ├── index.ts              # エントリーポイント（doPost / testRun をglobalにexport）
│   ├── config.ts             # スクリプトプロパティの読み込みと Config 型定義
│   ├── jina.ts               # Jina AI Reader による記事本文取得
│   ├── gemini.ts             # Gemini API による要約・構造化
│   ├── notion.ts             # Notion API へのレコード書き込み
│   ├── utils.ts              # 日付・週番号・レスポンス生成ユーティリティ
│   └── trend/
│       ├── index.ts          # トレンドモジュールの再エクスポート
│       ├── qiita.ts          # Qiita 人気記事フィードからトレンドURL取得
│       └── zenn.ts           # Zenn トレンドRSSフィードからトレンドURL取得
├── dist/                     # ビルド出力（clasp pushの対象、git管理外）
├── .github/
│   └── workflows/
│       ├── ci.yml            # CI ワークフロー
│       └── deploy.yml        # デプロイワークフロー
├── appsscript.json           # GAS マニフェスト
├── rollup.config.mjs         # Rollup 設定
├── tsconfig.json             # TypeScript 設定
├── biome.json                # Biome 設定
├── pnpm-workspace.yaml       # pnpm 設定（minimumReleaseAge など）
├── .node-version             # Node.js バージョン指定
├── .clasp.json               # clasp 設定（git管理外）
└── .clasp.json.example       # clasp 設定テンプレート
```

## セキュリティ

- `.clasp.json`（スクリプトID）はgit管理外
- `pnpm-workspace.yaml` の `minimumReleaseAge: 4320` により、公開から3日未満のパッケージはインストール不可（サプライチェーン攻撃対策）
- APIキー類はすべてGASのスクリプトプロパティで管理
