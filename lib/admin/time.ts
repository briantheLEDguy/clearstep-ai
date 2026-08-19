const amsterdam = "Europe/Amsterdam";

export class LocalDateTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDateTimeError";
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function parseLocal(value: string): LocalParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new LocalDateTimeError("Enter a valid Amsterdam date and time.");
  const [, year, month, day, hour, minute] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) };
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (
    candidate.getUTCFullYear() !== parts.year
    || candidate.getUTCMonth() + 1 !== parts.month
    || candidate.getUTCDate() !== parts.day
    || parts.hour > 23
    || parts.minute > 59
  ) {
    throw new LocalDateTimeError("Enter a valid Amsterdam date and time.");
  }
  return parts;
}

function offsetAt(instant: Date) {
  const label = new Intl.DateTimeFormat("en", {
    timeZone: amsterdam,
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label ?? "GMT+00:00");
  if (!match) return 0;
  const milliseconds = (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  return match[1] === "-" ? -milliseconds : milliseconds;
}

function localPartsAt(instant: Date): LocalParts {
  const output = new Intl.DateTimeFormat("en-CA", {
    timeZone: amsterdam,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(output.find((part) => part.type === type)?.value ?? "0");
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute") };
}

function sameLocalParts(first: LocalParts, second: LocalParts) {
  return first.year === second.year
    && first.month === second.month
    && first.day === second.day
    && first.hour === second.hour
    && first.minute === second.minute;
}

/**
 * Converts a datetime-local value only when it identifies one real instant in
 * Europe/Amsterdam. Rejecting DST gaps and repeated local times is safer than
 * silently moving a workshop or choosing one of two possible instants.
 */
export function amsterdamLocalToIso(value: string) {
  const parts = parseLocal(value);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) offsets.add(offsetAt(new Date(localAsUtc + hours * 60 * 60_000)));

  const matches = [...offsets]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((instant) => sameLocalParts(localPartsAt(instant), parts));

  if (matches.length === 0) {
    throw new LocalDateTimeError("This Amsterdam time does not exist because clocks change then. Choose another time.");
  }
  if (matches.length > 1) {
    throw new LocalDateTimeError("This Amsterdam time occurs twice because clocks change then. Choose a different time.");
  }
  return matches[0].toISOString();
}

export function toAmsterdamLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = localPartsAt(date);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function assertEndAfterStart(startAt: string, endAt: string) {
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw new LocalDateTimeError("The session end time must be after its start time.");
  }
}
