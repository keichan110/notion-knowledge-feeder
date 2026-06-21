/**
 * Gmailスレッドを検索する。
 * @param query Gmail検索クエリ
 * @returns 検索条件に一致したGmailスレッド配列
 */
export function searchThreads(query: string): GoogleAppsScript.Gmail.GmailThread[] {
  return GmailApp.search(query);
}

/**
 * Gmailメッセージの本文をプレーンテキストで取得する。
 * @param message 本文を取得するGmailメッセージ
 * @returns プレーンテキストの本文（空の場合は空文字列）
 */
export function getMessagePlainBody(message: GoogleAppsScript.Gmail.GmailMessage): string {
  return message.getPlainBody();
}

/**
 * Gmailスレッドのパーマリンクを取得する。
 * @param thread パーマリンク取得対象のGmailスレッド
 * @returns Gmailスレッドのパーマリンク
 */
export function getThreadPermalink(thread: GoogleAppsScript.Gmail.GmailThread): string {
  return thread.getPermalink();
}

/**
 * Gmailスレッドから指定ラベルを外す。
 * @param thread ラベル削除対象のGmailスレッド
 * @param labelName 削除するユーザーラベル名
 * @returns なし
 */
export function removeLabelFromThread(
  thread: GoogleAppsScript.Gmail.GmailThread,
  labelName: string
): void {
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) return;

  thread.removeLabel(label);
}
