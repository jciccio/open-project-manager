import { Suspense } from "react";
import { isOidcConfigured } from "@/lib/oidc";
import { LoginForm } from "./LoginForm";

// isOidcConfigured() reads process.env, which by itself doesn't opt this
// route out of static prerendering — without this, the OIDC vars supplied
// at container runtime (not build time) would never be reflected here.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm oidcEnabled={isOidcConfigured()} />
    </Suspense>
  );
}
