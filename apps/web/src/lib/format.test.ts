import { describe, expect, it } from 'vitest';
import { formatCedis, formatDate, formatDateTime, formatDuration } from './format';

describe('formatCedis', () => {
  it('shows pesewas as cedis with two decimals', () => {
    expect(formatCedis(123_456)).toBe('GH₵ 1,234.56');
  });

  it('keeps small amounts exact', () => {
    expect(formatCedis(5)).toBe('GH₵ 0.05');
    expect(formatCedis(0)).toBe('GH₵ 0.00');
  });

  it('shows negative amounts, such as payroll corrections', () => {
    expect(formatCedis(-1_050)).toBe('-GH₵ 10.50');
  });

  it('refuses amounts that are not whole pesewas', () => {
    expect(() => formatCedis(10.5)).toThrow(TypeError);
  });
});

describe('formatDate', () => {
  it('shows the same calendar date the API sent', () => {
    expect(formatDate('2026-09-15')).toMatch(/^15 Sept? 2026$/);
  });
});

describe('formatDateTime', () => {
  it('shows timestamps in Ghana time', () => {
    expect(formatDateTime('2026-09-15T08:30:00Z')).toMatch(/^15 Sept? 2026, 08:30$/);
  });
});

describe('formatDuration', () => {
  it('picks the two largest useful units', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(420)).toBe('7m');
    expect(formatDuration(7_500)).toBe('2h 5m');
    expect(formatDuration(273_600)).toBe('3d 4h');
  });
});
