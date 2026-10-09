import { redirect } from "next/navigation";
import { isRegistrationOpen } from "@/lib/registration";
import { RegisterForm } from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (!(await isRegistrationOpen())) {
    redirect("/login?error=registration_closed");
  }
  return <RegisterForm />;
}
