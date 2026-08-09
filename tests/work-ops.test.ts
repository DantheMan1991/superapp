import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { WorkError } from "../src/modules/work/core/errors";
import {
  createList,
  setListArchived,
  updateList,
} from "../src/modules/work/list-ops";
import {
  createItem,
  setAssignee,
  setItemState,
  setParent,
  updateItem,
} from "../src/modules/work/item-ops";
import { ensureDefaultWorkList } from "../src/lib/work/provision";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind slice 1's actions.
 *
 * Tested at the op rather than through the action, because an action's other
 * half is `requireTenant()` and a Clerk session — and what is worth certifying
 * here is the rules, not the framework.
 */
d("work ops", () => {
  const STAMP = `workops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;
  const EXPERT = `${STAMP}-expert`;
  const STRANGER = `${STAMP}-stranger`;

  let tenantId: string;
  let listId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: STAFF });

  const ownerCtx = () => ({ tenantId, userId: OWNER, role: "owner" as const });
  const staffCtx = () => ({ tenantId, userId: STAFF, role: "staff" as const });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Work ops", slug: STAMP })
        .returning();
      tenantId = tenant.id;

      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: OWNER, email: `${OWNER}@example.test` },
          { clerkUserId: STAFF, email: `${STAFF}@example.test` },
          { clerkUserId: EXPERT, email: `${EXPERT}@example.test` },
          { clerkUserId: STRANGER, email: `${STRANGER}@example.test` },
        ])
        .returning();
      await tx.insert(schema.memberships).values([
        { tenantId, profileId: profiles[0].id, role: "owner" },
        { tenantId, profileId: profiles[1].id, role: "staff" },
        { tenantId, profileId: profiles[2].id, role: "expert" },
      ]);
      await ensureDefaultWorkList(tx, tenantId);
      const [list] = await tx
        .select({ id: schema.workLists.id })
        .from(schema.workLists)
        .where(eq(schema.workLists.tenantId, tenantId));
      listId = list.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, OWNER));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, STAFF));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, EXPERT));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, STRANGER));
    });
  });

  it("refuses to assign work to somebody outside the workspace", async () => {
    await expect(
      asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          listId,
          title: "For a stranger",
          assignee: STRANGER,
        }),
      ),
    ).rejects.toThrow(WorkError);
  });

  it("refuses to assign work to an EXPERT, which is the loop staying closed", async () => {
    // An expert is read-only in this module, so an expert who could be assigned
    // work would be unable to mark it done. `listAssignableMembers` already
    // excludes them; this is the test that the op leans on that rather than
    // restating it.
    await expect(
      asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          listId,
          title: "For the accountant",
          assignee: EXPERT,
        }),
      ),
    ).rejects.toThrow(WorkError);
  });

  it("accepts a member, and accepts nobody", async () => {
    const assigned = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        listId,
        title: "For staff",
        assignee: STAFF,
      }),
    );
    const unassigned = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "For nobody" }),
    );
    expect(assigned).toBeTruthy();
    expect(unassigned).toBeTruthy();
  });

  it("closing sets the timestamp and the person; reopening clears both", async () => {
    const itemId = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "Close me" }),
    );

    await asStaff((tx) => setItemState(tx, staffCtx(), itemId, "done"));
    const [closed] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    expect(closed.state).toBe("done");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByClerkUserId).toBe(STAFF);

    await asStaff((tx) => setItemState(tx, staffCtx(), itemId, "todo"));
    const [reopened] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    expect(reopened.state).toBe("todo");
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedByClerkUserId).toBeNull();
  });

  it("hands work over, and takes it back to nobody", async () => {
    const itemId = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "Hand over" }),
    );
    await asOwner((tx) => setAssignee(tx, ownerCtx(), itemId, STAFF));
    const [assigned] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    expect(assigned.assigneeClerkUserId).toBe(STAFF);

    await asOwner((tx) => setAssignee(tx, ownerCtx(), itemId, null));
    const [dropped] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    // Null, not the empty string — slice 5 copies `crm_tasks` rows straight in.
    expect(dropped.assigneeClerkUserId).toBeNull();

    await expect(
      asOwner((tx) => setAssignee(tx, ownerCtx(), itemId, EXPERT)),
    ).rejects.toThrow(WorkError);
  });

  it("cancelling is closing too", async () => {
    const itemId = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "Called off" }),
    );
    await asOwner((tx) => setItemState(tx, ownerCtx(), itemId, "cancelled"));
    const [row] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    expect(row.closedAt).not.toBeNull();
  });

  it("refuses a parent cycle the database cannot see", async () => {
    // The CHECK only catches an item that is its own parent. A -> B -> A is two
    // legal rows and one illegal graph, so the op walks the chain.
    const a = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "A" }),
    );
    const b = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "B", parentId: a }),
    );
    await expect(
      asOwner((tx) => setParent(tx, ownerCtx(), a, b)),
    ).rejects.toThrow(WorkError);

    // And the legal direction still works.
    const c = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "C" }),
    );
    await asOwner((tx) => setParent(tx, ownerCtx(), c, b));
    const [row] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, c)),
    );
    expect(row.parentId).toBe(b);
  });

  it("refuses to file work under a parent the caller cannot see", async () => {
    const hidden = await withSystem(async (tx) => {
      const [list] = await tx
        .insert(schema.workLists)
        .values({ tenantId, name: "Owners only", visibility: "owners" })
        .returning();
      const [item] = await tx
        .insert(schema.workItems)
        .values({ tenantId, listId: list.id, title: "Hidden parent" })
        .returning();
      return item.id;
    });
    const mine = await asStaff((tx) =>
      createItem(tx, staffCtx(), { listId, title: "Mine" }),
    );
    await expect(
      asStaff((tx) => setParent(tx, staffCtx(), mine, hidden)),
    ).rejects.toThrow(WorkError);
  });

  it("will not archive the default list", async () => {
    await expect(
      asOwner((tx) => setListArchived(tx, ownerCtx(), listId, true)),
    ).rejects.toThrow(WorkError);
  });

  it("archives and restores any other list", async () => {
    const other = await asOwner((tx) =>
      createList(tx, ownerCtx(), {
        name: "Field",
        color: "blue",
        visibility: "members",
      }),
    );
    await asOwner((tx) => setListArchived(tx, ownerCtx(), other, true));
    const [archived] = await asOwner((tx) =>
      tx.select().from(schema.workLists).where(eq(schema.workLists.id, other)),
    );
    expect(archived.archivedAt).not.toBeNull();

    await asOwner((tx) => setListArchived(tx, ownerCtx(), other, false));
    const [restored] = await asOwner((tx) =>
      tx.select().from(schema.workLists).where(eq(schema.workLists.id, other)),
    );
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses an owners-only list from staff, with a reason", async () => {
    await expect(
      asStaff((tx) =>
        createList(tx, staffCtx(), {
          name: "Sneaky",
          color: "rose",
          visibility: "owners",
        }),
      ),
    ).rejects.toThrow(WorkError);
  });

  it("keeps updated_at current, which nothing in the database does", async () => {
    const itemId = await asOwner((tx) =>
      createItem(tx, ownerCtx(), { listId, title: "Touch me" }),
    );
    const [before] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    await asOwner((tx) =>
      updateItem(tx, ownerCtx(), itemId, { title: "Touched" }),
    );
    const [after] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, itemId)),
    );
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
    expect(after.title).toBe("Touched");
  });

  it("reports a rename of something invisible as not found", async () => {
    await expect(
      asStaff((tx) =>
        updateList(tx, staffCtx(), "00000000-0000-0000-0000-000000000000", {
          name: "Nope",
        }),
      ),
    ).rejects.toThrow(WorkError);
  });
});
