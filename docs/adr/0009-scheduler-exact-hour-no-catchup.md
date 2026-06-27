# ADR-0009: scheduler の catch-up を全廃し exact-hour 一致にする

- Status: Accepted
- Date: 2026-06-25
- Supersedes: ADR-0007 の catch-up 部分（§1 の `dailyAt(h)` ＝ `hour >= h` ＋当日ガード、および当日実行済みガードに関する記述）

## Context

ADR-0007 は `dailyAt(h)` を **`hour >= h` ＋「当日その枠を実行済みか」ガード**で判定し、7時台の発火がGASにスキップされても8時台以降が拾う**当日catch-up**（自己修復性）を与えた。状態は ScriptProperties に「枠ごとの最終実行日」として持つ。

weekly-notion-summary（ADR-0008）で**2つ目のheavyジョブ**（日曜14時台）を足す段で、この catch-up が矛盾を生むことが判明した。

- gmail-digest（heavy・`dailyAt(7)`）の catch-up 尾は **`[7,23]` 全体**に及び、14時もその圏内。7時台から13時台まで毎時トリガーが連続スキップされると、14時台に gmail-digest catch-up と weekly-notion-summary が**同一の `triggerHourly` 実行に同居**し、6分枠で2つのheavyが衝突しうる。
- ところが静的不変条件テスト（`schedule.test.ts`）が使う `dueHours(dailyAt(7))` は **`[7]` しか返さず** catch-up 尾を見ない。よって「同一時刻にheavyが2つ以上dueなら fail」は14時の同居を**検知できない**。
- つまり ADR-0008 が狙う「14時台のheavy単独使用」は、catch-up 仕様の下では**静的に証明できない**。

「重い処理を他のスケジュールと混ぜたくない」という要求を**確率ではなく証明可能な不変条件**として満たすには、catch-up 尾そのものを無くすのが最短。GASの毎時トリガーは通常かなり安定しており、対象は非クリティカルなダイジェスト／メンテナンス群（スキップ時に1回欠落しても次回は新しいウィンドウで回復する）なので、自己修復性を手放すコストは許容できると判断する。

用語の定義は [`CONTEXT.md`](../../CONTEXT.md) を参照。

## Decision

scheduler から catch-up を**全廃**し、発火条件を**exact-hour 一致**にする。

### 1. `dailyAt` / `weeklyAt` は厳密な時刻一致で判定する

- `dailyAt(h)` は **`hour === h`** で判定する（旧 `hour >= h` を廃止）。
- `weeklyAt(weekday, h)` は **`currentWeekday === weekday && hour === h`** で判定する（日曜＝0）。
- `everyHours(n)` は従来どおり `hour % n === 0`（変更なし）。
- 各ジョブはその枠の毎時トリガー実行で**ちょうど1回** due になる。

### 2. 当日／今週実行済みガードと ScriptProperties 状態を廃止する

catch-up が無くなれば「`hour >= h` の間に二重実行しないためのガード」は不要。`scheduler.ts` から当日ガード（`scheduler:dailyAt:lastRunDate:*`）の読み書きと `markDailyJobDone` 系を削除し、ScriptProperties の状態を持たない。weekly に当初想定した「今週実行済みガード」も最初から作らない。

### 3. 静的不変条件テストはそのまま本物の保証になる

`dueHours(dailyAt(h))` ＝ `[h]`、`dueHours(weeklyAt(_, h))` ＝ `[h]`（曜日非依存）は、exact-hour 化により**実際の占有時刻と一致する**。`schedule.test.ts` の「同一時刻にheavyが2つ以上dueなら fail」は無改修で正確な保証になり、gmail-digest（7時）と weekly-notion-summary（14時）の heavy 非衝突を静的に証明できる。

### 4. 維持するもの

ADR-0007 の骨格は維持する —— トリガースロットの時間粒度階層（`triggerEvery10Minutes` / `triggerHourly` /（予約）`triggerEveryMinute`）、宣言的スケジュールテーブル（単一の真実）、スロット名はWHENのみ、毎時以上はコード側cronで分岐、集約エラーシンク（`runTrigger`/`runCadence`）、`weight` の静的テスト。変えるのは catch-up（`hour >= h` ＋ガード）だけ。

## Consequences

- weekly-notion-summary の14時台 heavy 単独使用が、`schedule.test.ts` で**静的に証明可能**になる（ADR-0008 の前提が成立）。
- `scheduler.ts` から ScriptProperties 状態とガードロジックが消えて**単純化**する。Schedule 種別は `always` / `dailyAt` / `everyHours` / `weeklyAt`。
- **スキップ時はその回が欠落する**（リトライしない）。GASが該当時刻の毎時トリガーをスキップすると、その日の gmail-digest／その回の trends／その週の weekly-notion-summary は実行されず、欠けた回のデータは埋まらない（次回は新しいウィンドウ）。自己修復性を手放す代償。
- **同一時刻内の稀な二重発火が無防備になる**。当日ガードは「`hour >= h` 区間の二重実行防止」も兼ねていた。exact-hour では1つの時刻でしか due にならないが、GASが同じ"時"に毎時トリガーを2回発火させた場合は二重実行（例: ダイジェスト二重投稿）しうる。非クリティカルなため許容し、観測されたら軽量な冪等ガードを後付けする。
- **ADR-0004 の境界アンカーは不変**。ウィンドウは fire-time ではなく固定境界（前日7:00 / 日曜14:00）にアンカーされるので、正常発火する限り隣接実行は隙間なくタイルする。catch-up の有無に依らない。
- ADR-0007 の catch-up 部分を supersede するが、トリガー再編の構造的決定（スロット階層・宣言的テーブル・集約エラーシンク・weight静的テスト）はそのまま有効。
- 本ADRは決定の記録。`scheduler.ts` の exact-hour 化・ガード削除・`weeklyAt` 追加の実装は後続作業とする。
