import { describe, expect, it } from 'vitest';
import { parseFeedUrls } from './bookingsPlugin.js';

describe('parseFeedUrls', () => {
  it('splits on spaces, commas and new lines and upgrades webcal', () => {
    expect(parseFeedUrls('webcal://a.ics, https://b.ics\nhttps://c.ics')).toEqual([
      'https://a.ics',
      'https://b.ics',
      'https://c.ics',
    ]);
  });
  it('is empty when unset', () => {
    expect(parseFeedUrls(undefined)).toEqual([]);
    expect(parseFeedUrls('  ')).toEqual([]);
  });
});
