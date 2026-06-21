const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+/g;
const EMAIL_PATTERN = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LABELED_ID_PATTERN =
  /(会員番号|お客様番号|お客さま番号|顧客番号|顧客ID|購読者ID|会員ID|ユーザーID|アカウントID)([：:\s　]*)([!-~]+)/g;

/**
 * プレーンテキスト内の個人情報・識別子をマスクする。
 * @param text マスク対象のプレーンテキスト
 * @returns 個人情報・識別子をマスクした文字列
 */
export function maskPii(text: string): string {
  return text
    .replace(URL_PATTERN, '[リンク]')
    .replace(EMAIL_PATTERN, '[メールアドレス]')
    .replace(LABELED_ID_PATTERN, '$1$2[ID]');
}
