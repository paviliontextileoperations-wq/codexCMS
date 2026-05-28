import type { Customer } from "@/types";
import { customersStore } from "./storage";

const CUSTOMER_SYNC_KEY = "form.customers.v1";

export async function pushCustomersToCloud(customers?: Customer[]) {
  const desktopApp = window.desktopApp;
  if (!desktopApp?.cloudPush) return null;
  return desktopApp.cloudPush({
    clientId: "desktop-customers",
    records: [
      {
        key: CUSTOMER_SYNC_KEY,
        raw: JSON.stringify(customers ?? customersStore.all()),
      },
    ],
    skipNormalized: false,
  });
}
