import { NextResponse } from "next/server";
import type { ServiceErrorKind } from "@/lib/services/result";

const STATUS_BY_KIND: Record<ServiceErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  internal: 500,
};

export function serviceErrorStatus(kind: ServiceErrorKind | undefined): number {
  return kind ? STATUS_BY_KIND[kind] : 400;
}

export function serviceErrorResponse(res: { error?: string; kind?: ServiceErrorKind }) {
  return NextResponse.json({ error: res.error }, { status: serviceErrorStatus(res.kind) });
}
