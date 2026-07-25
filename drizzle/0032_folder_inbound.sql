-- Opt-in forwarding address per Documents folder: docs-<token>@<domain>.
--
-- Nullable and off by default: an inbound address is an anonymous WRITE
-- surface, so one should exist only where somebody asked for it.
--
-- The unique index is GLOBAL, not per tenant, for the same reason
-- document_shares.token_hash is: the webhook resolves the token with no
-- tenant context to scope by.
--
-- Safe against the running code (the 0025 lesson): a new nullable column,
-- and Drizzle builds explicit column lists so nothing deployed sees it.
ALTER TABLE "document_folders" ADD COLUMN "inbound_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_inbound_token_idx" ON "document_folders" USING btree ("inbound_token") WHERE "document_folders"."inbound_token" is not null;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_inbound_token_format" CHECK ("document_folders"."inbound_token" is null or "document_folders"."inbound_token" ~ '^[a-z0-9]{16,}$');