const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Crew shifts start on the event day; an earlier finish is on the next day. */
export function shiftHours(start: string, end: string): number | null {
  if (!TIME.test(start) || !TIME.test(end)) return null;
  const difference = minutes(end) - minutes(start);
  return (difference < 0 ? difference + 24 * 60 : difference) / 60;
}

export function endsNextDay(start: string, end: string): boolean {
  return shiftHours(start, end) !== null && minutes(end) < minutes(start);
}

export function shiftIssue(start: string, end: string): string | null {
  const hours = shiftHours(start, end);
  if (hours === null) return 'Choose valid start and end times.';
  if (hours === 0) return 'Shift start and end times must be different.';
  if (hours > 16) return 'A crew shift may not exceed 16 hours per day.';
  return null;
}
