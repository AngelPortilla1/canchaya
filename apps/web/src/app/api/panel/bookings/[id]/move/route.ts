import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { BookingValidationError, moveManualBooking } from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "bookings:manage");

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      newCourtId?: unknown;
      localDate?: unknown;
      localStartTime?: unknown;
    } | null;

    if (
      !body ||
      typeof body.newCourtId !== "string" ||
      typeof body.localDate !== "string" ||
      typeof body.localStartTime !== "string"
    ) {
      throw new BookingValidationError(
        "Debes seleccionar la nueva cancha, fecha y hora para mover la reserva.",
      );
    }

    const booking = await moveManualBooking({
      user,
      accessToken: accessToken!,
      bookingId: id,
      newCourtId: body.newCourtId,
      localDate: body.localDate,
      localStartTime: body.localStartTime,
    });

    return NextResponse.json({ booking }, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo mover la reserva.");
  }
}
