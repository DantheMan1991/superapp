export { LedgerError, friendlyMessage, type LedgerErrorCode } from "./errors";
export type { EntryLineInput, LedgerCtx, NewEntryInput, PostResult } from "./types";
export {
  assertEntryNotSourceManaged,
  assertNotIntercompanyLeg,
  assertPeriodOpen,
  getClosedThrough,
  getSettings,
  requireOwnerRole,
  requirePostingRight,
  requireReviewRole,
  setClosedThrough,
  MACHINE_SOURCES,
} from "./guards";
export {
  addCloseNote,
  closePeriodStart,
  completeClose,
  getClose,
  getCloseChecklist,
  listCloses,
  loadClose,
  reopenClose,
  signOffClose,
  type CloseChecklist,
  type CloseChecklistItem,
  type CloseNoteWithAuthor,
} from "./close";
export {
  deleteDraft,
  editEntry,
  postDraft,
  postEntry,
  reverseEntry,
  voidEntry,
} from "./posting";
export {
  createEntity,
  entityForRegisterAccount,
  entityScopeCondition,
  entityScopeLabel,
  getDefaultEntityId,
  groupClosedThrough,
  listEntities,
  provisionEntity,
  resolveEntityScope,
  resolveReportEntity,
  setDefaultEntity,
  updateEntity,
  type Consolidation,
  type EntityScope,
  type FilterScope,
  type ReportEntityView,
} from "./entities";
// `asFilterScope` is deliberately NOT re-exported: it is the one way past the
// compile error FilterScope exists to cause, and it stays inside core/.
export {
  consolidationResidual,
  residualIfConsolidated,
  residualNote,
  type ConsolidationResidual,
} from "./consolidation";
export {
  affiliateBalances,
  loadIntercompanyEntries,
  postIntercompanyPair,
  reverseIntercompanyPair,
  voidIntercompanyPair,
  type AffiliateBalance,
  type IntercompanyPair,
} from "./intercompany";
export { getBalances, getTrialBalance, ledgerIsBalanced, ledgerIsBalancedPerEntity, resolveBasis, type AccountingBasis, type BalanceRow, type TrialBalance, type TrialBalanceRow } from "./balances";
export {
  MAX_COA_DEPTH,
  NORMAL_BALANCE,
  createAccount,
  deactivateAccount,
  assertCodableAccounts,
  isCodableAccount,
  listAccounts,
  updateAccount,
  type AccountTypeValue,
} from "./coa";
export {
  archiveDimensionMember,
  listDimensionMembers,
  upsertDimensionMember,
} from "./dimensions";
export { getLedgerIntegrity, type LedgerIntegrity } from "./integrity";
export {
  cancelReconciliation,
  completeReconciliation,
  expectedLedgerCents,
  getReconciliationView,
  listReconciliations,
  reopenReconciliation,
  startReconciliation,
  toggleReconciliationLine,
  type ReconciliationCandidate,
  type ReconciliationView,
} from "./reconciliation";
export {
  GENERAL_LEDGER_LINE_CAP,
  getBalanceSheet,
  getCashActivity,
  getGeneralLedger,
  getProfitAndLoss,
  getTaxSummary,
} from "./reports";
export {
  buildTaxSummary,
  type TaxRateName,
  type TaxSummaryInvoice,
  type TaxSummaryRateRow,
  type TaxSummaryReport,
} from "./tax-summary";
export {
  BS_GROUP_BY_SUBTYPE,
  PNL_SECTION_BY_SUBTYPE,
  buildBalanceSheet,
  buildCashActivity,
  buildGeneralLedger,
  buildProfitAndLoss,
  bsGroupFor,
  displayCents,
  pnlSectionFor,
  type BalanceSheetReport,
  type CashActivityReport,
  type CashActivityRow,
  type GeneralLedgerAccount,
  type GeneralLedgerInputLine,
  type GeneralLedgerLine,
  type GeneralLedgerReport,
  type ProfitAndLossReport,
  type ReportColumn,
  type ReportRow,
  type ReportRowKind,
} from "./report-builders";
