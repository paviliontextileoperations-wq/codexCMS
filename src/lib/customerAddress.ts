import type { Address, Customer } from "@/types";

export type DeliveryAddressSource = "logistics" | "fiscal" | "none";

export function isUsableAddress(address?: Address | null): address is Address {
  return Boolean(address?.line1?.trim() && address?.country?.trim());
}

export function getCustomerDeliveryAddress(customer?: Customer | null): {
  address?: Address;
  source: DeliveryAddressSource;
} {
  if (isUsableAddress(customer?.logisticsAddress)) {
    return { address: customer.logisticsAddress, source: "logistics" };
  }
  if (isUsableAddress(customer?.fiscalAddress)) {
    return { address: customer.fiscalAddress, source: "fiscal" };
  }
  return { source: "none" };
}

export function deliverySourceSuffix(source: DeliveryAddressSource): string {
  return source === "fiscal" ? " / using fiscal address" : "";
}
