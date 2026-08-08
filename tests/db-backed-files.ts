// Test files that talk to the database.
//
// These run SEQUENTIALLY (see vitest.config.ts): they share one Neon branch,
// create and delete tenants, and several assert what is NOT visible across
// tenants — an assertion another file writing at the same moment can break.
// Everything else is pure and runs in parallel.
//
// THIS LIST IS CHECKED, NOT TRUSTED. tests/db-backed-files.test.ts recomputes
// it from file contents and fails if it has drifted, so adding a database test
// to a file that was pure cannot silently start racing.
export const DB_BACKED_TESTS = [
  "tests/attention-sources.test.ts",
  "tests/banking.test.ts",
  "tests/close.test.ts",
  "tests/contact.test.ts",
  "tests/crm-automation-ops.test.ts",
  "tests/crm-merge-ops.test.ts",
  "tests/crm-reports-ops.test.ts",
  "tests/crm-views-ops.test.ts",
  "tests/documents-dms/accounting-overlap.test.ts",
  "tests/documents-dms/folder-ops.test.ts",
  "tests/documents-dms/inbound.test.ts",
  "tests/documents-dms/search.test.ts",
  "tests/documents-dms/shares.test.ts",
  "tests/documents-dms/tags-and-views.test.ts",
  "tests/documents-dms/versions.test.ts",
  "tests/documents-templates.test.ts",
  "tests/documents.test.ts",
  "tests/email.test.ts",
  "tests/export.test.ts",
  "tests/interview.test.ts",
  "tests/invoicing.test.ts",
  "tests/isolation/accounting.test.ts",
  "tests/isolation/close.test.ts",
  "tests/isolation/core.test.ts",
  "tests/isolation/crm-rule-health.test.ts",
  "tests/isolation/crm-settings.test.ts",
  "tests/isolation/crm.test.ts",
  "tests/isolation/documents-dms.test.ts",
  "tests/isolation/documents.test.ts",
  "tests/isolation/interview.test.ts",
  "tests/isolation/mail.test.ts",
  "tests/isolation/membership.test.ts",
  "tests/isolation/notifications.test.ts",
  "tests/isolation/parties.test.ts",
  "tests/isolation/payables.test.ts",
  "tests/isolation/retainer.test.ts",
  "tests/isolation/shares.test.ts",
  "tests/ledger.test.ts",
  "tests/mail-inbox.test.ts",
  "tests/mailbox.test.ts",
  "tests/payables.test.ts",
  "tests/reports.test.ts",
  "tests/retainer-billing.test.ts",
];
