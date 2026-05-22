import { useEffect, useState, useCallback } from "react";
import { customersStore, productsStore, salesStore } from "@/lib/storage";
import { inventoryLocationStore, inventoryStore } from "@/lib/inventoryStore";
import type { Customer, InventoryLocation, InventoryMovement, Product, Sale } from "@/types";

function useReactiveStore<T>(read: () => T): [T, () => void] {
  const [data, setData] = useState<T>(read);
  const refresh = useCallback(() => setData(read()), [read]);
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("form-storage", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("form-storage", handler);
      window.removeEventListener("storage", handler);
    };
  }, [refresh]);
  return [data, refresh];
}

export function useProducts(): [Product[], () => void] {
  return useReactiveStore<Product[]>(() => productsStore.all());
}
export function useCustomers(): [Customer[], () => void] {
  return useReactiveStore<Customer[]>(() => customersStore.all());
}
export function useSales(): [Sale[], () => void] {
  return useReactiveStore<Sale[]>(() => salesStore.all());
}
export function useInventoryMovements(): [InventoryMovement[], () => void] {
  return useReactiveStore<InventoryMovement[]>(() => inventoryStore.all());
}
export function useInventoryLocations(): [InventoryLocation[], () => void] {
  return useReactiveStore<InventoryLocation[]>(() => inventoryLocationStore.all());
}
