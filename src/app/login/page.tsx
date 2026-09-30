import { Suspense } from "react";
import { isOidcConfigured } from "@/lib/oidc";
import { isRegistrationOpen } from "@/lib/registration";
import { LoginForm } from "./LoginForm";

// isOidcConfigured() reads process.env, which by itself doesn't opt this
// route out of static prerendering — without this, the OIDC vars supplied
// at container runtime (not build time) would never be reflected here.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const registrationOpen = await isRegistrationOpen();
  return (
    <Suspense>
      <LoginForm oidcEnabled={isOidcConfigured()} registrationOpen={registrationOpen} />
    </Suspense>
  );
}
