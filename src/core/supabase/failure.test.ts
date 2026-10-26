import { describe, expect, it } from "vitest";

import { isUnexpectedFailure } from "@/core/supabase/failure";

describe("isUnexpectedFailure", () => {
  const rpc = "/rest/v1/rpc/record_receipt";

  it("ignores successes", () => {
    expect(isUnexpectedFailure(rpc, 200)).toBe(false);
    expect(isUnexpectedFailure(rpc, 204)).toBe(false);
  });

  it("treats ordinary refusals as expected", () => {
    expect(isUnexpectedFailure(rpc, 400, "P0001")).toBe(false); // our own rule said no
    expect(isUnexpectedFailure(rpc, 403, "42501")).toBe(false); // not allowed
    expect(isUnexpectedFailure(rpc, 409, "23505")).toBe(false); // already exists
    expect(isUnexpectedFailure(rpc, 400, "22P02")).toBe(false); // bad input
    expect(isUnexpectedFailure("/rest/v1/orders", 406, "PGRST116")).toBe(false);
    expect(isUnexpectedFailure(rpc, 401, "PGRST301")).toBe(false);
  });

  it("flags real faults", () => {
    expect(isUnexpectedFailure(rpc, 404, "PGRST202")).toBe(true); // function missing
    expect(isUnexpectedFailure(rpc, 400, "42703")).toBe(true); // column missing
    expect(isUnexpectedFailure(rpc, 500, "57014")).toBe(true); // timed out
    expect(isUnexpectedFailure(rpc, 503)).toBe(true);
    expect(isUnexpectedFailure(rpc, 400)).toBe(true); // no code at all
  });

  it("only flags server errors on files, never on sign-in", () => {
    expect(isUnexpectedFailure("/storage/v1/object/x", 404)).toBe(false);
    expect(isUnexpectedFailure("/storage/v1/object/x", 502)).toBe(true);
    expect(isUnexpectedFailure("/auth/v1/user", 500)).toBe(false);
  });
});
