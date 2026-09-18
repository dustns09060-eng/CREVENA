// Supabase Auth returns error messages in English. Map the common ones a
// real signup/login screen hits to Korean so users aren't shown raw English.
const KNOWN_AUTH_ERRORS: { match: (msg: string) => boolean; ko: string }[] = [
  {
    match: (m) => m.includes("Email not confirmed"),
    ko: "이메일 인증이 아직 완료되지 않았습니다. 받은편지함에서 인증 메일의 링크를 클릭한 후 다시 로그인해주세요.",
  },
  {
    match: (m) => m.includes("Invalid login credentials"),
    ko: "이메일 또는 비밀번호가 올바르지 않습니다.",
  },
  {
    match: (m) => m.includes("User already registered"),
    ko: "이미 가입된 이메일입니다. 로그인해주세요.",
  },
  {
    match: (m) => /Email address .* is invalid/.test(m),
    ko: "올바른 이메일 주소를 입력해주세요.",
  },
  {
    match: (m) => m.includes("Password should be at least"),
    ko: "비밀번호는 최소 6자 이상이어야 합니다.",
  },
  {
    match: (m) => m.includes("rate limit"),
    ko: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  },
  {
    match: (m) => m.includes("Email link is invalid or has expired") || m.includes("Token has expired"),
    ko: "링크가 만료되었거나 유효하지 않아요. 재설정 이메일을 다시 받아주세요.",
  },
  {
    match: (m) => m.includes("New password should be different"),
    ko: "이전과 다른 비밀번호를 입력해주세요.",
  },
  {
    match: (m) => m.includes("Auth session missing"),
    ko: "인증 세션이 만료되었어요. 재설정 이메일을 다시 받아주세요.",
  },
];

export function translateAuthError(message: string): string {
  const found = KNOWN_AUTH_ERRORS.find((e) => e.match(message));
  return found?.ko ?? message;
}
