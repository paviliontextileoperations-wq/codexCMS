import { useEffect, useState } from "react";
import { AppShell, type TabKey } from "@/components/app/AppShell";
import { POSView } from "@/components/app/POSView";
import { ProductsView } from "@/components/app/ProductsView";
import { CustomersView } from "@/components/app/CustomersView";
import { SalesView } from "@/components/app/SalesView";
import { InvoicesView } from "@/components/app/InvoicesView";
import { ImagesView } from "@/components/app/ImagesView";
import { InventoryView } from "@/components/app/InventoryView";
import { SettingsView } from "@/components/app/SettingsView";
import { ApprovalsView } from "@/components/app/ApprovalsView";
import { OpLogView } from "@/components/app/OpLogView";
import { LoginScreen } from "@/components/app/LoginScreen";
import { useSession } from "@/lib/auth";
import { seedIfEmpty } from "@/lib/storage";

const Index = () => {
  const [tab, setTab] = useState<TabKey>("pos");
  const session = useSession();

  useEffect(() => {
    seedIfEmpty();
  }, []);

  // Redirect non-developers away from developer-only tabs.
  useEffect(() => {
    if ((tab === "approvals" || tab === "oplog") && session?.role !== "developer") {
      setTab("pos");
    }
  }, [tab, session]);

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <AppShell active={tab} onChange={setTab}>
      {tab === "pos" && <POSView />}
      {tab === "products" && <ProductsView />}
      {tab === "customers" && <CustomersView />}
      {tab === "sales" && <SalesView />}
      {tab === "invoices" && <InvoicesView />}
      {tab === "images" && <ImagesView />}
      {tab === "inventory" && <InventoryView />}
      {tab === "settings" && <SettingsView />}
      {tab === "approvals" && session.role === "developer" && <ApprovalsView />}
      {tab === "oplog" && session.role === "developer" && <OpLogView />}
    </AppShell>
  );
};

export default Index;
