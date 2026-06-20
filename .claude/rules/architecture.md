---
paths:
  - "src/capabilities/**/*"
  - "src/pipelines/**/*"
  - "src/index.ts"
---

# Capability / Pipeline アーキテクチャ

詳細は `docs/guides/capability-pipeline.md` を参照。用語は `CONTEXT.md`、背景は `docs/adr/0001-capability-pipeline-layers.md`。

## 必須ルール

- Capability（`src/capabilities/`）は外部システムへの薄いクライアント。ドメイン知識（プロンプト・出力スキーマ・ドメイン型・業務判断）を持たない
- Capabilityは設定を自分で読まない。APIキー・トークン等は引数で受け取る（注入）
- Pipeline（`src/pipelines/<feature>/`）が機能単位でドメインロジックを所有し、Capabilityを `Source → Transform → Sink` に配線する
- 依存方向は エントリポイント → Pipeline → Capability / lib。Capabilityは Pipeline に依存しない（逆流禁止）
- キューは逐次型Pipeline固有。ダイジェスト型は同期完結・キューなし
