# Google Apps Script セットアップガイド

本プロジェクトは GAS（Google Apps Script）上で動作します。
動作させるには、GAS のスクリプトプロパティに以下の値を登録する必要があります。

---

## スクリプトプロパティの登録

### 登録手順

1. [script.google.com](https://script.google.com) でプロジェクトを開く
2. 左メニューの **「プロジェクトの設定」（歯車アイコン）** をクリック
3. ページ下部の **「スクリプト プロパティ」** セクションで **「スクリプト プロパティを追加」** をクリック
4. 下表のプロパティ名と値を入力して **「スクリプト プロパティを保存」** をクリック

### 登録するプロパティ一覧

| プロパティ名 | 必須 | 説明 | 取得・設定方法 |
|---|:---:|---|---|
| `SECRET_TOKEN` | ✅ | Webhook リクエストの認証トークン | 任意の文字列を自分で決めて設定する（例: UUID） |
| `GEMINI_API_KEY` | ✅ | Gemini API の認証キー | [Google AI Studio](https://aistudio.google.com/app/apikey) で発行 |
| `GEMINI_MODEL` | | 使用する Gemini モデル名（未設定時は `gemini-3.5-flash`） | 変更が必要な場合のみ設定（例: `gemini-3.1-pro-preview`） |
| `NOTION_ACCESS_TOKEN` | ✅ | Notion コネクトのアクセストークン | [Notion Developer Portal](https://app.notion.com/developers/connections) でコネクトを作成し、Configuration タブのトークンをコピー |
| `NOTION_DB_ID` | ✅ | 保存先 Notion データベースの ID | データベースページを開き、URL の `https://www.notion.so/<workspace>/<database-id>?v=...` の `<database-id>` 部分（ハイフン区切りの 32 文字） |

---

## 各プロパティの詳細

### `SECRET_TOKEN`

iOS ショートカットなど外部クライアントから Webhook を叩く際に、リクエスト本文の `token` フィールドで送信する認証文字列です。
GAS 側でこの値と照合し、一致しない場合はリクエストを拒否します。

```json
{ "token": "ここに設定した値を入れる", "url": "https://example.com/article" }
```

推奨: `uuidgen` コマンドや [UUID Generator](https://www.uuidgenerator.net/) で生成したランダムな文字列を使用してください。

---

### `GEMINI_API_KEY`

記事本文を要約・構造化するために Gemini API を呼び出します。

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. **「Create API key」** をクリックして API キーを発行
3. 発行されたキー（`AIza...` で始まる文字列）を登録

---

### `GEMINI_MODEL`（省略可）

使用する Gemini のモデルを指定します。未設定の場合は `gemini-3.5-flash` が使われます。

| 値 | 特徴 |
|---|---|
| `gemini-3.5-flash`（デフォルト） | 最新世代。エージェント・コーディングタスク向けの最高知性モデル |
| `gemini-3.1-pro-preview` | 高度な知性・複雑な問題解決・強力なエージェント機能 |
| `gemini-3.1-flash-lite` | 大規模モデルに匹敵するフロンティア性能をより低コストで実現 |
| `gemini-2.5-flash` | 価格性能比が高い。低遅延・高スループットで推論にも対応 |
| `gemini-2.5-flash-lite` | 2.5 ファミリー最速・最安。シンプルなタスク向け |
| `gemini-2.5-pro` | 最高精度。複雑なタスク・深い推論が必要な場合に使用 |

---

### `NOTION_ACCESS_TOKEN`

Notion データベースへの書き込みに使うコネクトのアクセストークンです。

1. [https://app.notion.com/developers/connections](https://app.notion.com/developers/connections) を開く
2. サイドメニューの **「コネクト」** を選択
3. **「New connection」** をクリック
4. 名前（例: `notion-knowledge-feeder`）とワークスペースを選択して作成
5. **「Configuration」** タブに表示されたアクセストークンをコピー
6. **Notion データベースのページを開き、右上「…」→「Add connections」から作成したコネクトを追加** することを忘れずに行う

---

### `NOTION_DB_ID`

保存先のデータベース ID です。

1. ブラウザで対象の Notion データベースを開く
2. URL を確認する

```
https://www.notion.so/myworkspace/abcdef1234567890abcdef1234567890?v=...
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                  これが NOTION_DB_ID（32文字の英数字）
```

URL にハイフンが含まれている場合（`abcdef12-3456-7890-abcd-ef1234567890`）はそのまま登録しても動作します。

---

## 設定後の確認

スクリプトプロパティを登録後、GAS エディタから以下のテスト関数を実行して動作確認できます。

| 関数名 | 確認内容 |
|---|---|
| `testGeminiAPI` | Gemini API の疎通確認・要約結果の検証 |
| `testJinaFetch` | Jina AI Reader による記事取得の確認 |
| `testGeminiToNotion` | Notion への書き込み確認 |
| `testRun` | 記事取得 → 要約 → Notion 保存の全体統合テスト |

実行ログは GAS エディタの **「実行数」** または **「ログ（Ctrl+Enter）」** で確認できます。
