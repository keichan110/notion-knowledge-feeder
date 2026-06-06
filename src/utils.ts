/**
 * URLからクエリパラメーターを除去する。フラグメント（#以降）は保持する。
 * @param url 対象URL
 * @returns クエリパラメーターを除去したURL
 */
export function stripQueryString(url: string): string {
  const [withoutFragment, fragment] = url.split('#');
  const base = withoutFragment.split('?')[0];
  return fragment !== undefined ? `${base}#${fragment}` : base;
}

/**
 * GASのHTTPレスポンスオブジェクトを生成する。
 * @param success 処理成功フラグ
 * @param message レスポンスメッセージ
 * @returns JSON形式のテキストレスポンス
 */
export function createResponse(
  success: boolean,
  message: string
): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify({ success, message })).setMimeType(
    ContentService.MimeType.JSON
  );
}
