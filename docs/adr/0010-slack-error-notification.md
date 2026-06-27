# ADR-0010: エラー／warn通知をSlackエラー専用チャンネルへ送る

- Status: Accepted
- Date: 2026-06-27

## Context

GAS実行が失敗すると管理コンソールに「失敗」マークが付くが、エラーの詳細情報（どのステップで・何が・なぜ失敗したか）が失われ、原因調査が難航していた。Cloud Logging（GASコンソール）の情報だけでは修正の目星がつけられない。

既存の業務通知（gmail-digest・weekly-notion-summary）はSlackに投稿しているが、エラー通知を同じチャンネルに混ぜるとノイズになる。

用語の定義は [`CONTEXT.md`](../../CONTEXT.md) を参照。

## Decision

### 1. エラー専用Slackチャンネルへの通知基盤を `src/lib/notify.ts` に置く

`notifySlack` 関数を新設し、全Pipelineから横断的に利用する。依存方向は `Pipeline → lib/notify → capabilities/slack`（既存ルールに沿う）。

`log.error` の自動フックではなく、**開発者が根本原因の箇所で明示的に呼ぶ opt-in 方式**とする。リトライ中は正常動作の範囲内であり通知しない。リトライ上限到達や回復不能な失敗の時点で通知する。

### 2. severity は `error` と `warn` の2段

- **`error`**: 処理失敗。`<!channel>` メンションを付けて即座に気づけるようにする。メンションはハードコード。
- **`warn`**: 処理継続可能な異常（重複URLスキップ等）。メンションなし。

### 3. 通知メッセージはSlackだけで調査・修正の目星がつく粒度

error の通知内容:
- ジョブ名（例: `article-ingest:pending`）
- 失敗ステップ（例: `fetch`）
- エラーメッセージ
- コンテキスト情報（URL、Notion Page ID等）
- リトライ回数／上限
- タイムスタンプ（JST）
- スタックトレース

warn の通知内容:
- ジョブ名
- メッセージ
- コンテキスト情報
- タイムスタンプ（JST）

### 4. 通知失敗時は握りつぶす

Slack API自体がダウンしていた場合、`log.error` で記録して例外は握りつぶす。元の例外は再throwしてGAS実行を「失敗」にし、GASコンソール上で障害発生を確認できるようにする。

### 5. スクリプトプロパティの変更

- `SLACK_CHANNEL_ID` → `SLACK_NOTIFY_CHANNEL_ID` にリネーム（業務通知用）
- `SLACK_ERROR_CHANNEL_ID` を新設（エラー通知専用）
- `SLACK_BOT_TOKEN` は既存Botを共用（変更なし）

デプロイ手順: GASコンソールでプロパティ追加 → デプロイ → 旧プロパティ削除。

### 6. 関数インターフェース

```typescript
type Severity = 'error' | 'warn';
type NotifyParams = {
  severity: Severity;
  job: string;
  message: string;
  context?: object;
  err?: unknown;
};
function notifySlack(params: NotifyParams): void
```

Config（`slackBotToken`・`slackErrorChannelId`）は関数内部で取得する。呼び出し側は渡さない。

## Consequences

- **Slackの通知だけで障害の調査・修正着手が可能になる**。GASコンソールは「失敗したかどうか」の確認のみに使い、詳細情報のソースをSlackに一本化する。
- GASの失敗通知メール（既存）はOFFにする。Slack通知自体が失敗した場合はGASコンソールの実行履歴が最終防衛線。
- `error` にのみ `<!channel>` メンションが付くため、通知の緊急度がメンション有無で直感的に判別できる。
- 全Pipelineに `notifySlack` 呼び出しを追加する作業が発生する。既存の `log.error`/`log.warn` は Cloud Logging 用にそのまま残す。
- `SLACK_CHANNEL_ID` のリネームにより、既存の gmail-digest・weekly-notion-summary の Config 型（`SlackConfig`・`GmailDigestConfig`・`WeeklySummaryConfig`）も合わせて更新する。
- [[集約エラーシンク]]の `onError` フックに `notifySlack` を差し込む拡張が自然にできる（ADR-0007 で将来構想として言及済み）。
