ALTER TYPE "public"."journal_entry_source" ADD VALUE 'inventory_receipt' BEFORE 'intercompany';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'inventory_issue' BEFORE 'intercompany';--> statement-breakpoint
ALTER TYPE "public"."journal_entry_source" ADD VALUE 'inventory_adjustment' BEFORE 'intercompany';