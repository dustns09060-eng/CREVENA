// STEP45.1: the confirmed public support/contact channel, replacing the
// "[운영자 확인 필요] 문의 이메일 미설정" placeholders STEP45 left behind.
//
// This is intentionally PUBLIC contact information, not a secret — it is
// printed on /contact, /terms, /privacy, /refund-policy and the footer, and
// must stay identical across all of them, which is the only reason it lives
// in one constant instead of being typed out five times.
//
// Nothing else personal (전화번호, 주소, 대표자명, 사업자등록번호) belongs
// here: none of it is confirmed, and the legal pages keep their
// [운영자 확인 필요] markers for those.
export const SUPPORT_EMAIL = "dustns0906@kakao.com";
export const SUPPORT_EMAIL_HREF = `mailto:${SUPPORT_EMAIL}`;
