import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { BookingValidationError, rejectPendingDeposit } from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "deposits:validate");

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      rejectionReason?: unknown;
    } | null;

    if (!body || typeof body.rejectionReason !== "string") {
      throw new BookingValidationError("Debes indicar un motivo para rechazar el comprobante.");
    }

    const result = await rejectPendingDeposit({
      user,
      accessToken: accessToken!,
      paymentId: id,
      rejectionReason: body.rejectionReason,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo rechazar el anticipo.");
  }
}
