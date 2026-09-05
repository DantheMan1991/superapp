/**
 * The declared slot a pack fills on a tenant's website — Marketing slice 9b,
 * [ADR 0028](../../../docs/decisions/0028-a-packs-block-is-data-the-site-draws.md).
 *
 * TYPES ONLY, so that naming the slot drags nothing into a bundle (the P5
 * rule `production/core/handler.ts` set). The site knows the SHAPE of a
 * block — a kind, editor fields, a config those fields set, and a view of
 * rows to draw — and nothing of what fills it. A provider is registered in
 * `registry.ts`, the one file in this chain that names a pack; the site
 * reads through `resolve.ts`; the pure helpers are in `core.ts`.
 *
 * What a provider may do is deliberately small: describe its fields, check
 * a config, and answer a list of rows. It draws nothing — the site draws,
 * in the site's look, which is what keeps a pack's block from looking like
 * a widget dropped on the page and keeps markup a pack wrote off a public
 * origin (ADR 0019).
 */
export type BlockFieldValue = string | number | boolean;

/** What a block section stores: the values its provider's fields set. */
export type BlockConfig = Record<string, BlockFieldValue>;

export interface BlockFieldOption {
  value: string;
  label: string;
}

/** One editor control a provider asks for. The editor draws it; the provider never ships a component. */
export type BlockField =
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "select";
      options: BlockFieldOption[];
      /** The value a new section starts with; `""` when nothing is chosen yet. */
      default: string;
    }
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "switch";
      default: boolean;
    };

/** A block the editor may offer: what the page-editor route hands the client. */
export interface BlockCatalogEntry {
  /** `pack.block`, e.g. `retail.prices`. */
  kind: string;
  /** The module that must be switched on for the block to be offered and drawn. */
  pack: string;
  label: string;
  hint: string;
  fields: BlockField[];
}

/** One line of a block: a name, a word or two under it, an amount on the right, and whether it is to be had. */
export interface BlockRow {
  name: string;
  detail: string;
  amount: string;
  status: "" | "sold_out";
}

/** What the site draws for one block section, in its own look. */
export interface BlockView {
  rows: BlockRow[];
  /** A line under the rows, or blank. */
  footnote: string;
}

export interface SiteBlockProvider<Tx> {
  kind: string;
  pack: string;
  label: string;
  hint: string;
  /** The editor's controls for this tenant: a select's options come from the pack's own rows. */
  fields(tx: Tx, tenantId: string): Promise<BlockField[]>;
  /** The config the editor saved, checked; null when the block cannot show anything with it. Pure. */
  parseConfig(config: BlockConfig): BlockConfig | null;
  /** The rows to draw now. Runs inside the site's own tenant transaction, as the anonymous public reader. */
  load(tx: Tx, tenantId: string, config: BlockConfig, now: Date): Promise<BlockView>;
}
