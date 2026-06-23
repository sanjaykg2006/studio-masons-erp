/**
 * Auth abstraction layer.
 *
 * Today the ERP signs users in with email/password and magic links. The
 * company runs on Microsoft 365, so a likely next step is Microsoft Entra ID
 * (Azure) SSO. To keep that a drop-in change, every supported sign-in method
 * is named here as an `AuthProvider`. UI and guards depend on this type, not
 * on Supabase specifics — adding "azure" later means enabling the provider in
 * the Supabase dashboard and rendering one more button. No refactor.
 */
export type AuthProvider = "password" | "magic_link" | "azure" | "google";

/** Result shape returned by auth server actions, for inline form errors. */
export type AuthResult =
  | { ok: true }
  | { ok: false; error: string };

/** Minimal app-level user shape (decoupled from Supabase's User type). */
export type AppUser = {
  id: string;
  email: string | null;
};
