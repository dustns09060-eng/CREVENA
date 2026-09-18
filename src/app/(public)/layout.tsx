import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

// STEP45: route group for the public policy & info pages (/terms, /privacy,
// /refund-policy, /contact). A route group adds no path segment, so the URLs
// stay exactly as listed above. These pages must render for logged-out
// visitors — see the PUBLIC_PATHS allowlist in src/lib/supabase/middleware.ts.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
