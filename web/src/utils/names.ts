export interface Nameable {
  firstName?: string | null;
  displayName: string;
}

export function baseName(user: Nameable): string {
  return user.firstName || user.displayName;
}


export function sortByName<T extends Nameable>(list: T[]): T[] {
  return [...list].sort((a, b) => baseName(a).localeCompare(baseName(b)));
}
