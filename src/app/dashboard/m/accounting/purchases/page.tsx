import { redirect } from "next/navigation";

export default function PurchasesPage() {
  redirect("/dashboard/m/accounting/purchases/bills");
}
