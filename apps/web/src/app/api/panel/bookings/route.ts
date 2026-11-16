import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { BookingValidationError, createManualHoldBooking } from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "bookings:manage");

    const body = (await request.json().catch(() => null)) as {
      courtId?: unknown;
      customerId?: unknown;
      localDate?: unknown;
      localStartTime?: unknown;
      notes?: unknown;
    } | null;

    if (
      !body ||
      typeof body.courtId !== "string" ||
      typeof body.customerId !== "string" ||
      typeof body.localDate !== "string" ||
      typeof body.localStartTime !== "string"
    ) {
      throw new BookingValidationError(
        "Faltan datos obligatorios para crear la reserva (cancha, cliente, fecha u hora).",
      );
    }

    const booking = await createManualHoldBooking({
      user,
      accessToken: accessToken!,
      courtId: body.courtId,
      customerId: body.customerId,
      localDate: body.localDate,
      localStartTime: body.localStartTime,
      notes: typeof body.notes === "string" ? body.notes : null,
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo crear la reserva.");
  }
}
