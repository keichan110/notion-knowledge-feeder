export function getTodayString(): string {
  const now = new Date();
  return Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

export function getWeekString(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + startOfYear.getDay()) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function createResponse(
  success: boolean,
  message: string
): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify({ success, message })).setMimeType(
    ContentService.MimeType.JSON
  );
}
