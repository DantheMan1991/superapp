import Link from "next/link";
import { Paperclip } from "lucide-react";
import { withTenant } from "@/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listDocumentsForTarget,
  type LinkTarget,
} from "@/modules/accounting/documents/links";
import { readExtraction } from "@/modules/accounting/ai/extract-validate";
import { formatCents } from "@/modules/accounting/lib/money";
import { AttachExistingButton, DetachAttachmentButton } from "./document-attachments-controls";

/**
 * Server component: the "Bills & receipts" card on journal-entry and invoice
 * detail pages — lists attached documents, detaches, and attaches
 * existing inbox documents (the other direction of the inbox flow).
 */
export async function DocumentAttachments({
  tenantId,
  target,
}: {
  tenantId: string;
  target: LinkTarget;
}) {
  const rows = await withTenant(tenantId, (tx) =>
    listDocumentsForTarget(tx, tenantId, target),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" /> Bills &amp; receipts
        </CardTitle>
        <AttachExistingButton target={target} />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing attached.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ link, document }) => {
              const extraction = readExtraction(document.extraction);
              const vendor = extraction?.fields.vendorName.value;
              const total = extraction?.fields.totalCents.value;
              return (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <Link
                    href={`/dashboard/m/accounting/receipts/${document.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {vendor ?? document.fileName}
                    {total !== null && total !== undefined && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        ${formatCents(Math.abs(total))}
                      </span>
                    )}
                  </Link>
                  <DetachAttachmentButton linkId={link.id} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
