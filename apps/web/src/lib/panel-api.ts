import { InactiveOrMissingUserProfileError, RolePermissionDeniedError } from "@canchaya/core";
import { NextResponse } from "next/server";
import { UnauthenticatedError } from "./auth";
import { BookingConflictError, BookingNotFoundError, BookingValidationError } from "./bookings";

export function handlePanelApiError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof UnauthenticatedError || error instanceof InactiveOrMissingUserProfileError) {
    return NextResponse.json(
      { error: "Tu sesión expiró o no es válida. Inicia sesión nuevamente." },
      { status: 401 },
    );
  }
  if (error instanceof RolePermissionDeniedError) {
    return NextResponse.json(
      { error: "No tienes permisos para realizar esta acción." },
      { status: 403 },
    );
  }
  if (
    error instanceof BookingValidationError ||
    error instanceof BookingNotFoundError ||
    error instanceof BookingConflictError
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
