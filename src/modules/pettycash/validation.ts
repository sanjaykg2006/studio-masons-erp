/**
 * Pure input validation for the Petty Cash log-spend form. Kept out of actions.ts
 * (a "use server" file) so it can be unit-tested directly. Gives a clear up-front
 * message instead of a raw database error; the RPC remains the real guard.
 */
import type { PettyCashKind } from "@/modules/pettycash/types";

const KINDS: readonly PettyCashKind[] = ["reimbursement", "float"];

export function validatePettyCash(input: {
  amount: number;
  kind: string;
  /** YYYY-MM-DD; the day the money was spent. */
  spentOn?: string;
  /** YYYY-MM-DD; optional pay-by date. */
  dueDate?: string;
}): string | null {
  if (!(typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0)) {
    return "Enter an amount.";
  }
  if (!(KINDS as readonly string[]).includes(input.kind)) {
    return "Choose whether this is a reimbursement or a cash float.";
  }
  if (input.dueDate && input.spentOn && input.dueDate < input.spentOn) {
    return "The pay-by date can't be before the date of the spend.";
  }
  return null;
}
