// src/services/claude-usage-service.test.ts
import { describe, it, expect } from 'vitest';
import { getWeeklyResetDisplay, getTimeUntilReset } from '@/lib/usage-utils';

describe('Claude Usage Service', () => {
  describe('getWeeklyResetDisplay', () => {
    it('should show date and time when more than 24 hours away', () => {
      // Set reset time to 2 days from now
      const now = new Date('2026-01-03T12:00:00');
      const resetTime = new Date('2026-01-05T14:30:00');
      const resetAt = resetTime.toISOString();

      // Mock Date.now()
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      // Should display date and time format (MM-DD HH:mm)
      // Extract expected format from resetTime
      const month = String(resetTime.getMonth() + 1).padStart(2, '0');
      const day = String(resetTime.getDate()).padStart(2, '0');
      const hour = String(resetTime.getHours()).padStart(2, '0');
      const minute = String(resetTime.getMinutes()).padStart(2, '0');
      const expected = `${month}-${day} ${hour}:${minute}`;
      
      expect(result).toBe(expected);

      vi.useRealTimers();
    });

    it('should show countdown when within 24 hours', () => {
      // Set reset time to 23 hours and 30 minutes from now
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-04T11:30:00Z');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      // Should display countdown format
      expect(result).toBe('23h 30m');

      vi.useRealTimers();
    });

    it('should show countdown when exactly 23 hours away', () => {
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-04T11:00:00Z');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      expect(result).toBe('23h 0m');

      vi.useRealTimers();
    });

    it('should show date and time when exactly 24 hours away', () => {
      const now = new Date('2026-01-03T12:00:00');
      const resetTime = new Date('2026-01-04T12:00:00');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      // Should display date and time format when >= 24 hours
      const month = String(resetTime.getMonth() + 1).padStart(2, '0');
      const day = String(resetTime.getDate()).padStart(2, '0');
      const hour = String(resetTime.getHours()).padStart(2, '0');
      const minute = String(resetTime.getMinutes()).padStart(2, '0');
      const expected = `${month}-${day} ${hour}:${minute}`;
      
      expect(result).toBe(expected);

      vi.useRealTimers();
    });

    it('should handle minutes only when less than 1 hour', () => {
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-03T12:45:00Z');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      expect(result).toBe('45m');

      vi.useRealTimers();
    });

    it('should show "Resetting soon..." when time has passed', () => {
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-03T11:00:00Z'); // 1 hour ago
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getWeeklyResetDisplay(resetAt);
      
      expect(result).toBe('Resetting soon...');

      vi.useRealTimers();
    });
  });

  describe('getTimeUntilReset', () => {
    it('should show countdown format for 5-hour usage', () => {
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-03T15:30:00Z');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getTimeUntilReset(resetAt);
      
      expect(result).toBe('3h 30m');

      vi.useRealTimers();
    });

    it('should show "Resetting soon..." when time has passed', () => {
      const now = new Date('2026-01-03T12:00:00Z');
      const resetTime = new Date('2026-01-03T11:00:00Z');
      const resetAt = resetTime.toISOString();

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const result = getTimeUntilReset(resetAt);
      
      expect(result).toBe('Resetting soon...');

      vi.useRealTimers();
    });
  });
});
