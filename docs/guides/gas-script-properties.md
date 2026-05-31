# スクリプトプロパティの管理

設定値・APIキーはすべてGASのスクリプトプロパティで管理する。
各プロパティの登録手順は `docs/setup/google-app-script-setup.md` を参照。

## 管理するプロパティ一覧

| プロパティ名 | 用途 |
|---|---|
| `SECRET_TOKEN` | Webhookリクエストの認証トークン |
| `GEMINI_API_KEY` | Gemini API の認証キー |
| `GEMINI_MODEL` | 使用するGeminiモデル名（省略時はデフォルト値を使用） |
| `NOTION_ACCESS_TOKEN` | Notion APIのアクセストークン |
| `NOTION_DB_ID` | 保存先NotionデータベースのID |

## コードからのアクセス方法

**`PropertiesService` へのアクセスは `src/config.ts` 内のみに限定する。**
他のモジュールから `PropertiesService` を直接呼び出すことは禁止。

- 設定値（APIキー等）は `getConfig()` を経由して取得する
- 実行時状態フラグ（`HAS_PENDING` 等）は `config.ts` に定義された専用関数（`hasPending` / `setHasPending` / `clearHasPending`）を経由して操作する

```ts
// ✅ 正しい: getConfig() 経由で設定値を取得
import { getConfig } from './config';
const { geminiApiKey, notionDbId } = getConfig();

// ✅ 正しい: config.ts の専用関数経由で実行時フラグを操作
import { hasPending, setHasPending } from './config';
if (!hasPending()) setHasPending();

// ❌ 誤り: 他モジュールから PropertiesService を直接呼び出す
const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
```

## ハードコード禁止

APIキーや認証情報をソースコードに直接書くことは禁止。
`.clasp.json` はgit管理外（`.gitignore` に記載）であり、スクリプトプロパティはGASコンソールで管理する。
