import { describe, expect, it } from 'vitest';

import { dueHours } from './lib/scheduler';
import { HOURLY_SCHEDULE } from './schedule';

describe('HOURLY_SCHEDULE', () => {
  it('同一時刻にheavyジョブが2つ以上dueにならない', () => {
    for (let hour = 0; hour < 24; hour++) {
      const dueHeavyJobs = HOURLY_SCHEDULE.filter(
        (job) => job.weight === 'heavy' && dueHours(job.at).includes(hour)
      );

      expect(dueHeavyJobs.length, `${hour}時のheavyジョブ`).toBeLessThanOrEqual(1);
    }
  });
});
