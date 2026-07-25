/**
 * The starter cabinet every tenant gets when Documents is switched on.
 *
 * Deliberately whole-business, not back-office: a crew looking for the current
 * site drawings, a safety file for an inspector, and equipment manuals matter
 * as much as contracts and insurance certificates. Tenants rename, delete and
 * add freely — this is a starting shape, not a schema.
 *
 * All default folders are visibility 'members'. Nothing is hidden by default;
 * restricting a folder is an explicit owner decision.
 */
export interface DefaultFolder {
  name: string;
  sortOrder: number;
}

export const DEFAULT_FOLDERS: readonly DefaultFolder[] = [
  { name: "Jobs", sortOrder: 10 },
  { name: "Contracts", sortOrder: 20 },
  { name: "Insurance & Bonds", sortOrder: 30 },
  { name: "Licenses & Permits", sortOrder: 40 },
  { name: "Safety", sortOrder: 50 },
  { name: "Equipment", sortOrder: 60 },
  { name: "Suppliers", sortOrder: 70 },
  { name: "Photos", sortOrder: 80 },
  { name: "Admin", sortOrder: 90 },
];
