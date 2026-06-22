# ADR-0006: 個人情報マスキングを「regex（URL・ラベル付きID）＋ DLP（構造化PII）」のハイブリッドにする

- Status: Accepted
- Date: 2026-06-22

## Context

gmail-digest はメール本文を **Gemini（無料枠）** に渡して要約させる。無料枠は入力が学習に使われうるため、本文を第三者処理に渡す前に個人情報・識別子を落とす必要がある。現在は `src/lib/mask.ts` の `maskPii` が正規表現で URL・メールアドレス・ラベル付きID（会員番号など）・日本の電話番号をマスクしている（コミット 69eb39a・55a6d52。Gemini 入力本文にのみ適用し、件名・送信者・Slack 表示・要約結果は素のまま）。

正規表現方式は次の点で行き詰まりが見えた。

- **「車輪の再発明」感**。クレジットカード番号・マイナンバー・銀行口座・運転免許・パスポートといった**チェックサム/定型パターンのPII**を正規表現で網羅・保守するのは割に合わず、現に `maskPii` はこれらを未カバー。
- 精度（過剰マスク防止）と再現率（取りこぼし防止）のトレードオフを正規表現1本で抱え続けるのは限界がある。とくに gmail-digest は**日付（セミナー申込期限・開催日）を絶対に消してはならない**という強い不変条件があり、汎用化するほど日付衝突のリスクが上がる。

そこで Google Cloud の **Sensitive Data Protection（旧 Cloud DLP）** に重いマスキングを担わせられないかを調査した（調査メモは下記「調査結果」）。

### 調査結果（要点）

- **無料枠**: コンテンツ検査が月1GBまで無料（超過後 $3/GiB〜）。de-identify 変換は $1/GiB〜。gmail-digest の実データ量は月数十MB程度で無料枠に十分収まる。**ただし無料枠でも GCP の課金アカウント紐付けが必須**。
- **URL は DLP で扱えない**。DLP に URL infoType は無く、受信者ごとのトラッキングトークン入り URL を狙って消せない。→ **URL は事前に regex で落とす方式を残すのが正解**。剥がす本当の理由は「コスト削減」より「DLP では取りこぼす URL 内識別子を確実に消す」こと（コストは元々ほぼ無料）。
- **DLP が強い領域**（言語非依存・高精度）: `EMAIL_ADDRESS` / `PHONE_NUMBER` / `CREDIT_CARD_NUMBER` / `IBAN_CODE`、日本特化の `JAPAN_INDIVIDUAL_NUMBER`(マイナンバー) / `JAPAN_BANK_ACCOUNT` / `JAPAN_DRIVERS_LICENSE_NUMBER` / `JAPAN_PASSPORT` / `JAPAN_CORPORATE_NUMBER`。正規表現が苦手な構造化PIIを肩代わりできる。
- **DLP でも車輪が消えない領域**: 氏名 `PERSON_NAME`・住所 `STREET_ADDRESS` は学習が英語圏中心で**日本語（漢字氏名・日本の住所）の検出は不安定**。会員番号などラベル付きIDに該当 infoType は無く、結局 `customInfoType`（=正規表現）を DLP リクエストに書き直すことになる（ドメイン知識は消えず置き場所が移るだけ）。
- **日付保護**: `inspectConfig.infoTypes` に **DATE を入れなければ日付は構造的に絶対マスクされない**。正規表現で神経を使っていた日付保護が、ホワイトリスト方式で自然に満たせる（むしろ安全側）。

## Decision

マスキングを **regex と DLP のハイブリッド**で構成する。役割は重複させず分担する。

```
本文
 ↓ regex（mask.ts）: URL → [リンク]              （DLP不可領域。継続）
 ↓ DLP content:deidentify                        （汎用・構造化PII）
      infoTypes: EMAIL_ADDRESS, PHONE_NUMBER, CREDIT_CARD_NUMBER, IBAN_CODE,
                 JAPAN_INDIVIDUAL_NUMBER, JAPAN_BANK_ACCOUNT,
                 JAPAN_DRIVERS_LICENSE_NUMBER, JAPAN_PASSPORT, JAPAN_CORPORATE_NUMBER
      ※ DATE は入れない（日付は不変条件として保護）
 ↓ regex（mask.ts）: 会員番号等のラベル付きID → [ID]   （DLPに無いドメイン固有）
 ↓ Gemini へ
```

- **regex（`src/lib/mask.ts`）の責務**: ① URL の事前除去（DLP不可）、② 会員番号など**ドメイン固有のラベル付きID**。汎用PII（メール・電話）は DLP に移管しうるが、移管は実装フェーズで判断する。
- **DLP の責務**: メール・電話・クレジットカード・各種**公的番号**など、言語非依存で検出できる構造化PII。
- **日付の不変条件**: DLP 側は `DATE` を infoTypes に含めないことで構造的に保証する。regex 側も従来どおりラベルの無い数字列はマスクしない。
- **適用範囲は現状維持**: マスキングは Gemini 入力本文にのみ適用する。件名・送信者・Slack 表示・要約結果には適用しない（ADR-0005 の出力構成を変えない）。

### 前提条件（DLP 採用の代償）

- **GCP プロジェクト＋課金アカウント＋DLP API 有効化**が必要。無料枠運用でも課金紐付けは外せない。
- appsscript.json に **`cloud-platform` という広い OAuth スコープ**を追加する必要があり、セキュリティ面で要検討。
- **メール1通ごとに同期 HTTPS 呼び出し**が増える。DLP 呼び出しが失敗した場合は **fail-closed**（マスク未完の本文を Gemini に渡さず、その通をスキップ）とする。
- **DLP の検出はオフライン単体テスト不可**。現行 `mask.ts` の 12 テストが持つ「ローカルで完結する回帰テスト」の利点を DLP 部分では失う（HTTP モックが必要）。

## Consequences

- 構造化PII（クレカ・マイナンバー・口座・免許・パスポート）のカバレッジが正規表現では届かない水準に上がる。一方で**氏名・住所の日本語検出精度は期待ほど上がらない**（DLP の弱点として受容する）。
- マスキングのドメイン知識は完全には無くならない。URL とラベル付きIDは regex に残り続け、`mask.ts` は廃止せず**スリム化＋DLP前段**として併存する。
- 障害点が1つ増える（DLP 通信）。fail-closed により「マスクできないなら要約しない」を守る。コストは無料枠内に収まる前提で、超過監視は実装時に検討する。
- 本 ADR は**方向性（アーキテクチャ）の確定**であり、regex 部分は実装済み、DLP 連携は未実装。実装フェーズで「汎用PII（メール・電話）を regex から DLP へ移すか」「ラベル付きIDを customInfoType に寄せるか」を別途決める。
