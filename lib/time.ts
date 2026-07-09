export function addMinutesToTime(start: string, durationMinutes: number): string {
  const [hours = "0", minutes = "0"] = start.split(":");
  const totalMinutes =
    Number.parseInt(hours, 10) * 60 +
    Number.parseInt(minutes, 10) +
    durationMinutes;
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const endHours = Math.floor(normalized / 60);
  const endMinutes = normalized % 60;

  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}
