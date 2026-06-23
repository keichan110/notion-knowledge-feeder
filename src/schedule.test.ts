import { describe, expect, it } from 'vitest';

import { dueHours } from './lib/scheduler';
import { HOURLY_SCHEDULE, TEN_MINUTE_SCHEDULE } from './schedule';

describe('スケジュールテーブル', () => {
  it('同一時刻にheavyジョブが2つ以上dueにならない', () => {
    const schedules = [...HOURLY_SCHEDULE, ...TEN_MINUTE_SCHEDULE];

    for (let hour = 0; hour < 24; hour++) {
      const dueHeavyJobs = schedules.filter(
        (job) => job.weight === 'heavy' && dueHours(job.at).includes(hour)
      );

      expect(dueHeavyJobs.length, `${hour}時のheavyジョブ`).toBeLessThanOrEqual(1);
    }
  });
});
