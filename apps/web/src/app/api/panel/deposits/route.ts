import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import {
  BookingValidationError,
  listPendingDepositValidations,
  registerManualDepositReceipt,
} from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "deposits:validate");

    const deposits = await listPendingDepositValidations({
      user,
      accessToken: accessToken!,
    });

    return NextResponse.json({ deposits }, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo consultar la cola de anticipos pendientes.");
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "deposits:validate");

    const body = (await request.json().catch(() => null)) as {
      bookingId?: unknown;
      receiptMediaUrl?: unknown;
      amountCop?: unknown;
      method?: unknown;
    } | null;

    if (
      !body ||
      typeof body.bookingId !== "string" ||
      typeof body.receiptMediaUrl !== "string"
    ) {
      throw new BookingValidationError(
        "Faltan datos obligatorios para registrar el comprobante (reserva y URL o referencia).",
      );
    }

    const amountCop =
      typeof body.amountCop === "number" && Number.isInteger(body.amountCop)
        ? body.amountCop
        : undefined;
    const method =
      body.method === "cash" || body.method === "transfer" ? body.method : undefined;

    const payment = await registerManualDepositReceipt({
      user,
      accessToken: accessToken!,
      bookingId: body.bookingId,
      receiptMediaUrl: body.receiptMediaUrl,
      amountCop,
      method,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo registrar el comprobante de anticipo.");
  }
}
