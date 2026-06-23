import { beforeEach, describe, expect, it, vi } from "vitest";

// getPermissions() is wrapped in React's cache() so it runs once per request.
// In tests we replace cache() with a pass-through so each call re-reads our
// mocked data instead of returning a memoized result from an earlier test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});

// Stand in for the Supabase server client. `rpc` returns whatever a test sets,
// so no database (and no env vars) are needed.
const rpc = vi.fn();
vi.mock("@/core/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

// Imported after the mocks above are registered.
import { can, getPermissions } from "@/core/rbac/permissions";

/** Make the mocked RPC return the given (resource, action) grants. */
function grants(rows: { resource: string; action: string }[]) {
  rpc.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  rpc.mockReset();
});

describe("getPermissions", () => {
  it("turns the user's grants into a set of resource:action keys", async () => {
    grants([
      { resource: "dashboard", action: "read" },
      { resource: "projects", action: "create" },
    ]);

    const perms = await getPermissions();

    expect(perms.has("dashboard:read")).toBe(true);
    expect(perms.has("projects:create")).toBe(true);
    expect(perms.has("projects:read")).toBe(false);
  });

  it("returns an empty set when the lookup errors (deny-by-default)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const perms = await getPermissions();

    expect(perms.size).toBe(0);
  });
});

describe("can", () => {
  it("allows an action that is explicitly granted", async () => {
    grants([{ resource: "projects", action: "update" }]);

    expect(await can("projects", "update")).toBe(true);
  });

  it("denies anything not granted", async () => {
    grants([{ resource: "projects", action: "read" }]);

    expect(await can("projects", "delete")).toBe(false);
    expect(await can("invoices", "read")).toBe(false);
  });

  it("treats a '*' wildcard grant as that action on every resource", async () => {
    grants([{ resource: "*", action: "read" }]);

    expect(await can("projects", "read")).toBe(true);
    expect(await can("invoices", "read")).toBe(true);
    // ...but only for the action the wildcard actually grants.
    expect(await can("projects", "delete")).toBe(false);
  });

  it("denies everything when the user has no role / no grants", async () => {
    grants([]);

    expect(await can("dashboard", "read")).toBe(false);
  });
});
