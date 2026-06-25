# ADR-0008: weekly-notion-summary を「タグ名寄せ要約＋週次トリガー」で設計する

- Status: Accepted（設計確定・未実装）
- Date: 2026-06-25

## Context

`CONTEXT.md` には **weekly-notion-summary**（Notionに溜まった記事を週次でまとめSlackへ通知するダイジェスト型）が**構想として**だけ登録されていた。今回これを設計確定する。

要望は2点 —— (a)「今週どんなことがトレンドだったか」、(b)「どのトピックが人気か」を週次で集約したい。検討の過程で次の制約・気づきが重なった。

- **人気の軸はカテゴリーよりタグ**: 当初は9種固定カテゴリー（`AI/ML` 等）での集計を想定したが、トレンドの粒度としては記事ごとの**タグ（固有名詞・技術名を優先した3〜5語）**の方が有用。
- **タグは表記揺れする**: タグは article-ingest の Gemini が記事ごとに自由生成するため、同じ概念が `Claude` / `claude` / `Claude Code`、`RAG` / `検索拡張生成` / `retrieval`、`k8s` / `Kubernetes` のように割れる。生のまま件数集計するとランキングが壊れる。
- **Source区別フィールドが無い**: Notion DBには「トレンドフィード由来（Qiita/Zenn）か手動登録（iOSショートカット）か」を区別するプロパティが無い。両者は同じDBに同じ形で入る。
- **overviewはプロパティでなく本文ブロック**: `overview` はNotionプロパティではなくページ配下のブロックに格納されている（`article-ingest/pending.ts` の `articleSummaryBlocks`）。一方 `タイトル` / `カテゴリー` / `タグ` はプロパティで、1回の `queryDatabase` で取れる。
- **週次トリガーが無い**: scheduler（`src/lib/scheduler.ts`）は `dailyAt(h)` / `everyHours(n)` / `always()` のみで、週次の発火条件を持たない。
- **6分制限とheavy衝突の静的検出**: 1実行6分上限。`triggerHourly` は同一時刻にdueな全ジョブを1実行内で直列に回す。ADR-0007 §5 により「同一時刻にheavyが2つ以上dueなら `schedule.test.ts` がfail」する不変条件が既にある。

用語の定義は [`CONTEXT.md`](../../CONTEXT.md) を参照。

## Decision

weekly-notion-summary を**ダイジェスト型パイプライン**として実装し、トレンドの正体を「**表記揺れタグをGeminiが意味で名寄せしたクラスタ**」に置く。件数はコードで決定的に集計し、要約のみGeminiに委ねる。

### 1. Source ＝ その週の完了レコード全部

集計対象は、集計ウィンドウ内に `created_time` を持つ `ステータス=完了` のNotionレコード**すべて**。トレンド由来／手動登録を区別しない（区別フィールドが無く、区別する意味も薄い）。これは「自分が今週集めた記事の傾向」を表す。`処理待ち`／`エラー` は除外する。

### 2. 取得は title + category + tags のみ（overviewは使わない）

Geminiに渡す素材は `タイトル` + `カテゴリー` + `タグ`。すべてNotionプロパティなので**1クエリ（`has_more`/`next_cursor` でページネーション）で取得**でき、ページ毎のブロック読み取りも notion capability の追加関数も要らない。過去に溜まった記事もそのまま全対象にできる。

- **overviewブロック読み取りは不採用**: overviewブロックの位置特定が本文構造に依存して脆く、記事数分（週40〜60回）のNotion呼び出しが要る。精度の上積みに対しコストが見合わない。
- **escape hatch**: 運用してテーマが浅いと感じたら、次の一手は overview の**プロパティ化**（block読みではなく）。`article-ingest/pending.ts` の `updateRecord` に1プロパティ追加すれば恒久解決でき、本パイプライン側は1クエリのまま据え置ける。過去分は空になる点だけ許容する。

### 3. Transform ＝ Geminiは「名寄せ＋総括」、件数はコードが数える

Gemini呼び出しは**1回**。入力は各記事の `title` + `category`（クラスタ精度の文脈に使うが表示はしない）+ `tags`。出力は構造化JSONで:

```jsonc
{
  "summary": "今週の総括（1段落）",
  "topics": [
    { "label": "RAG / 検索拡張生成", "memberTags": ["RAG", "検索拡張生成", "retrieval"] },
    { "label": "LLMエージェント",    "memberTags": ["AI Agent", "MCP", "Claude Code"] }
  ]
}
```

- Geminiは**意味で同じタグをまとめた名寄せクラスタ（代表ラベル → 生タグ群）**と総括だけを返す。
- **件数はコードで決定的に集計する**。各クラスタの記事数 = `memberTags` のいずれかを持つ記事の数。Geminiに数えさせない（ADR-0001／本PJの「集計の正確さはPipelineが所有」原則と整合。gmail-digest がプロンプト・スキーマをPipelineに置くのと同じ）。
- 1記事が複数クラスタの `memberTags` を持つ場合、その記事は各クラスタで重複カウントしてよい（「そのトピックに触れた記事数」の意味）。

### 4. ランキングと表示しきい値

クラスタを記事数**降順**に並べ、**件数2以上・最大8件**を「今週のトレンドトピック」として表示する。単発タグ（件数1）はトレンドとみなさず除外する。突出したクラスタが無い週は「今週は突出したトピックはありませんでした」と表示し、総括で補う。

### 5. Sink ＝ Slack 1メッセージ（Block Kit）

固定サイズの小さな塊なので、gmail-digest（ADR-0003）のような親＋スレッド分割はせず**1メッセージで完結**する。構成は ヘッダー（対象期間＋総件数）＋ 総括 ＋ 🔥 今週のトレンドトピック（代表ラベル・件数・構成タグ）。

- **カテゴリーランキングは出さない**（タグ中心に振ったため）。category は §3 のGemini入力文脈には残すが表示はしない。
- **各トピックの実記事リンクは出さない**（v1）。必要になればNotionページURLを持ち回って後付けできる escape hatch とする。
- **0件時**は「今週は対象記事がありませんでした」をSlackへ投稿し、**Geminiは呼ばない**（gmail-digest の0件フォールバックと同じ流儀）。
- 出力先は gmail-digest と**同じSlackチャンネルをConfigごと再利用**する。専用チャンネル分離はマルチチャンネルconfig（ADR-0007 でスコープ外とされた将来設計）が前提になるため、それまでは単一チャンネル。

### 6. When ＝ `weeklyAt(SUN, 14)` を新設（ADR-0007 のフラクタル拡張）

scheduler に週次の発火条件 `weeklyAt(weekday, hour)` を追加する。

- `HOURLY_SCHEDULE` に `{ name: 'weekly-notion-summary', weight: 'heavy', at: weeklyAt(0, 14), run: () => runWeeklyNotionSummary() }` を1行追加する（日曜＝0）。
- 判定は **`currentWeekday === weekday && hour >= hour` ＋「今週その枠を実行済みか」ガード**。`dailyAt` の当日catch-upを週単位に拡張したもの（ガード状態は ScriptProperties に「枠ごとの最終実行週」として持つ）。
- 集計ウィンドウは **日曜14:00 JST境界にアンカーしたローリング7日**（先週日14:00〜今週日14:00）。`created_time` の ISO 8601 タイムスタンプで Notion をフィルタ（`on_or_after` / `before`）。遅延発火しても境界は14:00固定で、隣接週が隙間なく連続する（ADR-0004 の前日ウィンドウと同じ思想）。
- **heavy衝突の静的担保**: `dueHours(weeklyAt(_, h))` は `[h]` を返す（曜日非依存・保守的）。これにより `schedule.test.ts` の「同一時刻にheavyが2つ以上dueなら fail」に自動で乗る。日曜14時台は他ジョブが無い空き枠で、gmail-digest の heavy（7時台）とも衝突しない＝6分枠を単独使用できる。

### 7. PIIマスキングは不要

扱うのは公開記事の `title` + `tags` のみで、本文・個人情報を第三者（Gemini）に渡さない。gmail-digest と異なり PIIマスキング（ADR-0006）は適用しない。

## Consequences

- weekly-notion-summary が「構想中」から「設計確定・未実装」へ進む。実装は別作業。
- トレンドの正体が「タグの名寄せクラスタ」に定義され、表記揺れに強い集約ができる。「横断テーマ抽出」と「人気タグ集計」が1回のGemini呼び出しに統合される。
- 集計の正確さはコードが保証し、Geminiは名寄せと文章生成だけを担う。Geminiの数え間違いがランキングに混入しない。
- scheduler に週次粒度が加わり、ADR-0007 のフラクタル拡張が日次→週次へ実証される。`dueHours` と当日ガードを週次へ一般化する小改修が `scheduler.ts` に入る。
- 重い週次ジョブの隔離は「空き時刻に単独配置」＋「`schedule.test.ts` の heavy 不変条件」で担保され、6分タイムアウト事故をデプロイ前に潰せる。
- overview を使わない代償としてテーマ粒度はタイトル＋タグ依存になる。浅い場合の打ち手（overviewプロパティ化）は予約済み。
- Slackは単一チャンネル共有のままで、専用チャンネル分離はマルチチャンネルconfig（ADR-0007 将来作業）に従属する。
