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
| `GEMINI_MODEL` | | 使用する Gemini モデル名（未設定時は `gemini-3.1-flash-lite`） | 変更が必要な場合のみ設定（例: `gemini-3.1-pro-preview`） |
| `NOTION_ACCESS_TOKEN` | ✅ | Notion コネクトのアクセストークン | [Notion Developer Portal](https://app.notion.com/developers/connections) でコネクトを作成し、Configuration タブのトークンをコピー |
| `NOTION_DB_ID` | ✅ | 保存先 Notion データベースの ID | データベースページを開き、URL の `https://www.notion.so/<workspace>/<database-id>?v=...` の `<database-id>` 部分（ハイフン区切りの 32 文字） |
| `SLACK_BOT_TOKEN` | ✅※ | Slack Bot トークン（業務通知・エラー通知で共用） | Slack アプリを作成し Bot User OAuth Token（`xoxb-...`）を取得（詳細は下記） |
| `SLACK_NOTIFY_CHANNEL_ID` | ✅※ | 業務通知（ダイジェスト等）の投稿先 Slack チャンネル ID | 投稿先チャンネルの「チャンネル詳細」最下部、または URL 末尾の `C...`（詳細は下記） |
| `SLACK_ERROR_CHANNEL_ID` | ✅※ | エラー通知専用の投稿先 Slack チャンネル ID | 業務通知とは別のチャンネルを推奨（詳細は下記） |

※ `SLACK_BOT_TOKEN` / `SLACK_NOTIFY_CHANNEL_ID` / `SLACK_ERROR_CHANNEL_ID` は **Slack 通知機能を使う場合に必須**。使わない場合は未設定でも他の機能は動作する。

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

使用する Gemini のモデルを指定します。未設定の場合は `gemini-3.1-flash-lite` が使われます。

| 値 | 特徴 |
|---|---|
| `gemini-3.5-flash` | 最新世代。エージェント・コーディングタスク向けの最高知性モデル |
| `gemini-3.1-pro-preview` | 高度な知性・複雑な問題解決・強力なエージェント機能 |
| `gemini-3.1-flash-lite`（デフォルト） | 大規模モデルに匹敵するフロンティア性能をより低コストで実現 |
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

### `SLACK_BOT_TOKEN`（ダイジェスト機能を使う場合は必須）

前日の Newsletter ダイジェストを Slack へ投稿するための Bot トークンです。

1. [https://api.slack.com/apps](https://api.slack.com/apps) で **「Create New App」→「From scratch」** を選択
2. アプリ名（例: `sherpia-digest`）と投稿先ワークスペースを選んで作成
3. 左メニュー **「OAuth & Permissions」** → **Bot Token Scopes** に **`chat:write`** を追加
4. ページ上部の **「Install to Workspace」** でワークスペースにインストール
5. 表示された **「Bot User OAuth Token」**（`xoxb-...`）をコピーして登録
6. **投稿先チャンネルにこのアプリを招待**する（対象チャンネルで `/invite @アプリ名`）。招待しないと投稿に失敗します

---

### `SLACK_NOTIFY_CHANNEL_ID`（Slack 通知機能を使う場合は必須）

業務通知（Newsletter ダイジェスト・週次サマリー等）の投稿先チャンネル ID です（チャンネル名ではなく `C...` 形式の ID）。

1. Slack で対象チャンネルを開き、ヘッダーのチャンネル名をクリック
2. 表示されたダイアログ最下部の **「チャンネル ID」**（`C` で始まる文字列）をコピー

ブラウザ版 Slack の場合、URL 末尾の `.../C0123ABCD` の `C0123ABCD` 部分でも確認できます。

---

### `SLACK_ERROR_CHANNEL_ID`（Slack 通知機能を使う場合は必須）

エラー通知専用の投稿先チャンネル ID です。業務通知チャンネルとは別のチャンネルを設定することを推奨します（エラー通知が業務通知のノイズにならないようにするため）。

取得方法は `SLACK_NOTIFY_CHANNEL_ID` と同じです。Bot アプリをこのチャンネルにも招待してください。

---

## ウェブアプリのデプロイ

### 初回デプロイ

1. [script.google.com](https://script.google.com) でプロジェクトを開く
2. 右上の **「デプロイ」→「新しいデプロイ」** をクリック
3. 種類として **「ウェブアプリ」** を選択
4. 以下の通り設定して **「デプロイ」** をクリック

| 項目 | 設定値 |
|---|---|
| 次のユーザーとして実行 | 自分（自分のアカウント） |
| アクセスできるユーザー | 全員 |

### デプロイ ID の確認

CI による自動デプロイに必要なデプロイ ID は以下の手順で確認できます。

1. GAS エディタで **「デプロイ」→「デプロイを管理」** を開く
2. 作成したウェブアプリの右にある **「鉛筆アイコン（編集）」** をクリック
3. 上部に表示される **デプロイ ID**（`AKfycbx...` のような文字列）をコピー

---

## 時間ベーストリガーの設定

各機能はGASの時間ベーストリガーで起動します。利用する機能に応じて以下のトリガーを設定してください。

### 設定手順（共通）

1. [script.google.com](https://script.google.com) でプロジェクトを開く
2. 左メニューの **「トリガー」（時計アイコン）** をクリック
3. 右下の **「トリガーを追加」** をクリック
4. 下表の通り設定して **「保存」** をクリック（機能ごとに繰り返す）

### 設定するトリガー一覧

| 実行する関数 | 機能 | イベントのソース | トリガーのタイプ | 間隔 |
|---|---|---|---|---|
| `processPendingArticles` | 記事の非同期処理 | 時間主導型 | 分ベースのタイマー | 10 分おき |
| `runGmailDigest` | Newsletter ダイジェスト | 時間主導型 | 日付ベースのタイマー | 午前 7 時〜8 時 |
| `runGmailLabelCleanup` | アーカイブ済みメールのラベル整理 | 時間主導型 | 日付ベースのタイマー | 任意の時間帯（日次） |

いずれも **「実行するデプロイを選択」は `Head`** を指定します。

> **Gmail の再認可について**
> `runGmailDigest` / `runGmailLabelCleanup` は Gmail へのアクセス権限を新たに必要とします。これらのトリガーを初めて保存・実行する際に Google の認可画面が表示されるので、表示された権限（Gmail の読み取り・変更）を許可してください。許可しないとトリガー実行が失敗します。
