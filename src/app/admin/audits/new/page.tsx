import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewAuditForm } from "./new-audit-form";

export const dynamic = "force-dynamic";

export default function NewAuditPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/audits"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to discovery
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New discovery engagement</CardTitle>
          <CardDescription>
            Give the copilot whatever you know so far — it will tell you what
            to find out. Add notes as you talk to the prospect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAuditForm />
        </CardContent>
      </Card>
    </div>
  );
}
