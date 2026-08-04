"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PartyContactKind, PartyContactPoint } from "@/db/schema";
import { contactKindLabel } from "@/lib/parties/contact-values";
import {
  addContactPointAction,
  deleteContactPointAction,
  findDuplicateContactAction,
  setPrimaryContactPointAction,
} from "../actions";

const KINDS: PartyContactKind[] = ["email", "phone", "website"];

/**
 * How to reach this record.
 *
 * The duplicate check runs on blur rather than on every keystroke: it is a
 * database lookup per call and an address is not meaningfully checkable until
 * somebody has finished typing it. It WARNS and never blocks — two people at
 * one company genuinely share `info@`, and a product that refuses the second
 * record teaches its users to add a full stop to get past it.
 */
export function ContactPoints({
  partyId,
  points,
}: {
  partyId: string;
  points: PartyContactPoint[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<PartyContactKind>("email");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [duplicates, setDuplicates] = useState<
    { partyId: string; displayName: string }[]
  >([]);
  const [checking, startCheck] = useTransition();
  const [pending, startTransition] = useTransition();

  function checkDuplicates() {
    if (value.trim().length === 0) {
      setDuplicates([]);
      return;
    }
    startCheck(async () => {
      const result = await findDuplicateContactAction({
        kind,
        value,
        excludePartyId: partyId,
      });
      setDuplicates("error" in result ? [] : (result.data ?? []));
    });
  }

  function submit() {
    if (value.trim().length === 0) {
      toast.error("Enter a value first");
      return;
    }
    startTransition(async () => {
      const result = await addContactPointAction({
        partyId,
        kind,
        value: value.trim(),
        label: label.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setValue("");
      setLabel("");
      setDuplicates([]);
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">How to reach them</h2>
          <p className="text-xs text-muted-foreground">
            Shared with Accounting and offered when composing mail.
          </p>
        </div>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-2 size-4" />
            Add
          </Button>
        )}
      </div>

      {points.length === 0 && !adding ? (
        <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
          No contact details yet.
        </p>
      ) : (
        points.length > 0 && (
          <ul className="divide-y rounded-md border">
            {points.map((point) => (
              <ContactRow key={point.id} point={point} partyId={partyId} />
            ))}
          </ul>
        )
      )}

      {adding && (
        <div className="space-y-3 rounded-md border px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="crm-contact-kind">Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as PartyContactKind);
                  setDuplicates([]);
                }}
              >
                <SelectTrigger id="crm-contact-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {contactKindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="crm-contact-value">
                {contactKindLabel(kind)}
              </Label>
              <Input
                id="crm-contact-value"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setDuplicates([]);
                }}
                onBlur={checkDuplicates}
                placeholder={
                  kind === "email"
                    ? "name@example.com"
                    : kind === "phone"
                      ? "+1 555 123 4567"
                      : "example.com"
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-contact-label">Label (optional)</Label>
            <Input
              id="crm-contact-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="work, mobile, billing…"
            />
          </div>

          {checking && (
            <p className="text-xs text-muted-foreground">Checking…</p>
          )}
          {duplicates.length > 0 && (
            // A warning, not a block. Says WHO already has it so the person can
            // decide whether that is a mistake or two people sharing a mailbox.
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              Already on{" "}
              {duplicates.map((d, i) => (
                <span key={d.partyId}>
                  {i > 0 && ", "}
                  <a
                    href={`/dashboard/m/crm/records/${d.partyId}`}
                    className="font-medium underline"
                  >
                    {d.displayName}
                  </a>
                </span>
              ))}
              . You can still add it.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setAdding(false);
                setValue("");
                setLabel("");
                setDuplicates([]);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactRow({
  point,
  partyId,
}: {
  point: PartyContactPoint;
  partyId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{point.value}</p>
        <p className="text-xs text-muted-foreground">
          {contactKindLabel(point.kind)}
          {point.label && ` · ${point.label}`}
        </p>
      </div>

      {point.isPrimary ? (
        <Badge variant="secondary">Main</Badge>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Make ${point.value} the main ${point.kind}`}
          onClick={() =>
            startTransition(async () => {
              const result = await setPrimaryContactPointAction({
                contactPointId: point.id,
                partyId,
              });
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              router.refresh();
            })
          }
        >
          <Star className="size-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove ${point.value}`}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteContactPointAction({
              contactPointId: point.id,
              partyId,
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Removed");
            router.refresh();
          })
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </li>
  );
}
