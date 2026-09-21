// Signup consent: the ONE place that names the document versions a new member
// agrees to. These strings are (a) sent to Supabase Auth as user metadata at
// signup, (b) validated and copied into public.user_consents by the
// handle_new_user() trigger (migration 0030), and (c) printed on /terms and
// /privacy, so what is recorded can always be tied back to the published text.
//
// When the wording of a document changes in a way members must re-agree to,
// bump the matching constant here AND decide separately how existing members
// are re-prompted — bumping a constant never touches existing consent rows.
//
// Versions must match /^[A-Za-z0-9._-]{1,32}$/ (the database enforces it).
export const TERMS_VERSION = "v1";
export const PRIVACY_VERSION = "v1";
// 만 14세 이상 확인 is a declaration, not a document; it is versioned the same
// way so the exact wording shown next to the checkbox can be identified later.
export const AGE_DECLARATION_VERSION = "v1";

export type SignupConsentInput = {
  ageOver14: boolean;
  terms: boolean;
  privacy: boolean;
};

export function hasAllRequiredConsents(input: SignupConsentInput): boolean {
  return input.ageOver14 === true && input.terms === true && input.privacy === true;
}

/**
 * The `options.data` payload for supabase.auth.signUp, or null when any
 * required consent is missing (the caller must then not send the request).
 *
 * This is only what the CLIENT claims. It is not trusted: the trigger in
 * migration 0030 re-validates it inside the database, which is what stops a
 * request that bypasses this form.
 */
export function buildSignupConsentData(input: SignupConsentInput): { consent: Record<string, unknown> } | null {
  if (!hasAllRequiredConsents(input)) return null;
  return {
    consent: {
      age_over_14: true,
      age_version: AGE_DECLARATION_VERSION,
      terms_version: TERMS_VERSION,
      privacy_version: PRIVACY_VERSION,
    },
  };
}
