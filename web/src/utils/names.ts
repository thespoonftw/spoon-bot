export interface Nameable {
  firstName?: string | null;
  surname?: string | null;
  displayName: string;
}

export function baseName(user: Nameable): string {
  return user.firstName || user.displayName;
}

// Label for a name dropdown/list: shows the first name, but appends the surname
// (or Discord name, if no surname is set) whenever another entry in the same
// list shares that first name.
export function dropdownName(user: Nameable, allInList: Nameable[]): string {
  const base = baseName(user);
  if (!user.firstName) return base;
  const dupes = allInList.filter(u => baseName(u) === base).length;
  if (dupes <= 1) return base;
  const suffix = user.surname || user.displayName;
  return suffix ? `${base} ${suffix}` : base;
}

export function sortByName<T extends Nameable>(list: T[]): T[] {
  return [...list].sort((a, b) => baseName(a).localeCompare(baseName(b)));
}
