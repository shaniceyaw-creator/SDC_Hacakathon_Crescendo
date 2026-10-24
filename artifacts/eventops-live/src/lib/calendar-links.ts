// "Add to Google Calendar" links and .ics downloads for a worker's jobs (times are Malaysia time).

export type CalendarJob = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  end_date?: string | null; // last day; same hours every day
  start_time: string; // HH:MM (event start)
  end_time: string; // HH:MM
  duration_hours?: number;
  area: string;
  my_role?: string;
  report_time?: string; // when the crew should arrive
  shift_end_time?: string; // exact assigned shift finish, including teardown
};

function stamp(date: string, hhmm: string, addMinutes = 0) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  // Build in UTC from Malaysia time (UTC+8) so the result does not depend on the browser's zone.
  const t = new Date(Date.UTC(y, mo - 1, d, h - 8, mi + addMinutes));
  return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addDay(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function dayCount(job: CalendarJob) {
  const end = (job.end_date ?? job.date).slice(0, 10);
  return Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${job.date.slice(0, 10)}T00:00:00Z`)) / 864e5) + 1);
}

function shiftWindow(job: CalendarJob, offset = 0) {
  // A default teardown shift may finish just after midnight. Assigned finish
  // times already include teardown and must not receive another extra hour.
  const date = addDay(job.date.slice(0, 10), offset);
  const start = job.report_time ?? job.start_time;
  const end = job.shift_end_time ?? job.end_time;
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const teardown = job.shift_end_time ? 0 : 60;
  const overnight = minutes(end) + teardown <= minutes(start) ? 1440 : 0;
  return {
    start: stamp(date, start),
    end: stamp(date, end, teardown + overnight),
  };
}

export function googleCalendarUrl(job: CalendarJob) {
  const { start, end } = shiftWindow(job);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: job.my_role ? `${job.name} (${job.my_role})` : job.name,
    dates: `${start}/${end}`,
    location: `${job.area}, Malaysia`,
    details: 'OpusEvents shift. Report time includes setup.',
    ctz: 'Asia/Kuala_Lumpur',
  });
  const n = dayCount(job);
  if (n > 1) params.set('recur', `RRULE:FREQ=DAILY;COUNT=${n}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const escape = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function icsFile(jobs: CalendarJob[]) {
  const now = stamp(new Date().toISOString().slice(0, 10), '08:00');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpusEvents//Worker jobs//EN', 'CALSCALE:GREGORIAN'];
  for (const job of jobs) {
    const n = dayCount(job);
    for (let i = 0; i < n; i++) {
      const { start, end } = shiftWindow(job, i);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${job.id}-${i}@eventops`,
        `DTSTAMP:${now}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escape(job.my_role ? `${job.name} (${job.my_role})` : job.name)}`,
        `LOCATION:${escape(`${job.area}, Malaysia`)}`,
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(jobs: CalendarJob[], filename = 'my-opusevents-jobs.ics') {
  const url = URL.createObjectURL(new Blob([icsFile(jobs)], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
