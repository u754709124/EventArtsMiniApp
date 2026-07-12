function pad(value: number) {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatArticleDisplayTime(value: string | Date | null | undefined, nowInput: Date = new Date()) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = Number.isNaN(nowInput.getTime()) ? new Date() : nowInput;
  const dayDelta = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86400000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayDelta === 0) return `今天 ${time}`;
  if (dayDelta === 1) return `昨天 ${time}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
