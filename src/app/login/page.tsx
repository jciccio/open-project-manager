import { Suspense } from "react";
import { isOidcConfigured } from "@/lib/oidc";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm oidcEnabled={isOidcConfigured()} />
    </Suspense>
  );
}
