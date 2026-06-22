/**
 * GAS実行ログ出力ユーティリティ。`console.*` を使用してCloud Loggingにseverity付きで記録する。
 */
export const log = {
  /** @param mod モジュール名 @param msg メッセージ @param ctx 追加コンテキスト */
  info: (mod: string, msg: string, ctx?: object): void => console.log(fmt(mod, msg, ctx)),

  /** @param mod モジュール名 @param msg メッセージ @param ctx 追加コンテキストまたはエラー */
  warn: (mod: string, msg: string, ctx?: unknown): void => console.warn(fmt(mod, msg, ctx)),

  /**
   * @param mod モジュール名 @param msg メッセージ @param err 発生したエラー
   * @param ctx 追加コンテキスト
   */
  error: (mod: string, msg: string, err?: unknown, ctx?: object): void =>
    console.error(`${fmt(mod, msg, ctx)}${err !== undefined ? ` ${String(err)}` : ''}`),
};

const fmt = (module: string, msg: string, ctx?: unknown): string => {
  if (ctx === undefined) return `[${module}] ${msg}`;
  if (typeof ctx === 'object' && ctx !== null && !(ctx instanceof Error)) {
    return `[${module}] ${msg} | ${JSON.stringify(ctx)}`;
  }
  return `[${module}] ${msg} ${String(ctx)}`;
};
