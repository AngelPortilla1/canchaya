import { InactiveOrMissingUserProfileError, RolePermissionDeniedError } from "@canchaya/core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  UnauthenticatedError,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { loadTenantDailyCalendar } from "@/lib/calendar";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;

    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "calendar:view");

    const { searchParams } = new URL(request.url);
    const localDate = searchParams.get("date") ?? undefined;

    if (localDate && !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return NextResponse.json(
        { error: "Formato de fecha inválido. Usa YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const calendar = await loadTenantDailyCalendar({
      user,
      accessToken: accessToken!,
      localDate,
    });

    return NextResponse.json(calendar, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof InactiveOrMissingUserProfileError) {
      return NextResponse.json(
        { error: "Tu sesión expiró o no es válida. Inicia sesión nuevamente." },
        { status: 401 },
      );
    }
    if (error instanceof RolePermissionDeniedError) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar el calendario." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "No se pudo cargar el calendario del día." },
      { status: 500 },
    );
  }
}
