export interface Nameable {
  firstName?: string | null;
  displayName: string;
}

export function baseName(user: Nameable): string {
  return user.firstName || user.displayName;
}

// Label for a name dropdown/list: shows the name, but appends the Discord name
// whenever another entry in the same list shares that name.
export function dropdownName(user: Nameable, allInList: Nameable[]): string {
  const base = baseName(user);
  if (!user.firstName) return base;
  const dupes = allInList.filter(u => baseName(u) === base).length;
  if (dupes <= 1) return base;
  return user.displayName ? `${base} (${user.displayName})` : base;
}

export function sortByName<T extends Nameable>(list: T[]): T[] {
  return [...list].sort((a, b) => baseName(a).localeCompare(baseName(b)));
}
