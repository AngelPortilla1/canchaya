import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { BookingValidationError, cancelManualBooking } from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "bookings:manage");

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      cancellationReason?: unknown;
    } | null;

    if (!body || typeof body.cancellationReason !== "string") {
      throw new BookingValidationError("El motivo de cancelación es obligatorio.");
    }

    const booking = await cancelManualBooking({
      user,
      accessToken: accessToken!,
      bookingId: id,
      cancellationReason: body.cancellationReason,
    });

    return NextResponse.json({ booking }, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo cancelar la reserva.");
  }
}
