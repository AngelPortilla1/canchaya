import { DEFAULT_TIMEZONE, formatLocalDateInTimezone } from "@canchaya/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DailyCalendar } from "@/components/panel/DailyCalendar";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { loadTenantDailyCalendar } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;

  if (!accessToken) {
    redirect("/login");
  }

  let calendarData;
  try {
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "calendar:view");
    calendarData = await loadTenantDailyCalendar({
      user,
      accessToken,
    });
  } catch {
    redirect("/login");
  }

  const todayLocalDate = formatLocalDateInTimezone(
    new Date(),
    calendarData.grid.timezone || DEFAULT_TIMEZONE,
  );

  return <DailyCalendar initialData={calendarData} todayLocalDate={todayLocalDate} />;
}
