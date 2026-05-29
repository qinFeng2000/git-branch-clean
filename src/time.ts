const HOURS_PER_WEEK = 24 * 7;

export function formatBranchAge(ageHours: number): string {
  const normalizedAgeHours = Math.max(0, Math.floor(ageHours));

  if (normalizedAgeHours > HOURS_PER_WEEK) {
    const weeks = Math.max(1, Math.floor(normalizedAgeHours / HOURS_PER_WEEK));
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }

  return `${normalizedAgeHours} 小时前`;
}
