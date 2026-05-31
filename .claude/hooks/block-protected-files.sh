#!/bin/bash
export PATH="/usr/bin:/bin:$PATH"
# Claude が直接編集してはいけないファイルを定義する
# 該当ファイルへの Edit / Write をブロックする（exit 2）

BLOCKED=(
  "pnpm-lock.yaml"  # パッケージマネージャーが管理
  ".clasp.json"     # GAS デプロイ設定（git 管理外）
  "dist/"           # ビルド生成物
)

FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"file_path":"[^"]*"' | sed 's/"file_path":"//;s/"//')

for pattern in "${BLOCKED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "直接編集禁止: $FILE_PATH ($pattern)"
    exit 2
  fi
done
