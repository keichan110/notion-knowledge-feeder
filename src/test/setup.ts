import { vi } from 'vitest';

const mockFetchResponse = {
  getContentText: vi.fn().mockReturnValue(''),
  getResponseCode: vi.fn().mockReturnValue(200),
};

vi.stubGlobal('UrlFetchApp', {
  fetch: vi.fn().mockReturnValue(mockFetchResponse),
});

vi.stubGlobal('PropertiesService', {
  getScriptProperties: vi.fn().mockReturnValue({
    getProperty: vi.fn().mockReturnValue(null),
  }),
});

vi.stubGlobal('Utilities', {
  formatDate: vi.fn().mockReturnValue('2026-01-01'),
});

vi.stubGlobal('Session', {
  getScriptTimeZone: vi.fn().mockReturnValue('Asia/Tokyo'),
});

const mockTextOutput = {
  setMimeType: vi.fn().mockReturnThis(),
};

vi.stubGlobal('ContentService', {
  createTextOutput: vi.fn().mockReturnValue(mockTextOutput),
  MimeType: { JSON: 'application/json' },
});
