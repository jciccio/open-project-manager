import { NextResponse } from "next/server";

// Pages land here when the session cookie still verifies but the server
// rejects it (revoked or deleted user). A page render cannot clear cookies,
// and the middleware would bounce a signed cookie from /login back to /.
export async function GET() {
  const response = new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  response.cookies.delete("opm_session");
  return response;
}
