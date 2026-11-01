export {
  animeHomeModel,
  animeListLabels,
} from "../../../../shared/anime-lists";

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseCalendarDate(
  value: string | null,
  now = new Date(),
): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(now);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!, 12);
  return date.getFullYear() === y &&
    date.getMonth() === m! - 1 &&
    date.getDate() === d
    ? date
    : new Date(now);
}
export function calendarWeek(anchor: Date, firstDay: number) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() - firstDay + 7) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return date;
  });
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end, days };
}
