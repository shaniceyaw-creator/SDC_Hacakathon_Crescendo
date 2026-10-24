import type { QueryClient } from '@tanstack/react-query';
import {
  getGetEventQueryKey, getGetManagerDashboardQueryKey, getGetTeamQueryKey, getGetWorkerHomeQueryKey, getListBookingsQueryKey,
  getGetBookingProgressQueryKey, getGetCalendarQueryKey, getGetCustomerHomeQueryKey,
} from '@workspace/api-client-react';

export async function invalidateBookingData(qc: QueryClient, eventId: string) {
  await Promise.all([
    getGetEventQueryKey(eventId), getGetManagerDashboardQueryKey(), getGetTeamQueryKey(), getGetWorkerHomeQueryKey(),
    getListBookingsQueryKey(), getGetBookingProgressQueryKey(eventId), getGetCalendarQueryKey(), getGetCustomerHomeQueryKey(),
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}
