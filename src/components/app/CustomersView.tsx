import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, Pencil, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCustomers, useSales } from "@/hooks/useStore";
import { customersStore } from "@/lib/storage";
import type { Customer, ClientType, SaleDocumentType } from "@/types";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { CustomerForm, composeCustomer, customerToDraft, emptyCustomer, type CustomerDraft } from "./CustomerForm";
import type { Address } from "@/types";
import { useSession } from "@/lib/auth";
import { approvalsStore, usePendingDeletes } from "@/lib/approvals";
import { cn } from "@/lib/utils";
import { pushCustomersToCloud } from "@/lib/cloudCustomers";

const CUSTOMER_RENDER_BATCH = 90;

function formatAddress(a?: Address): string {
  if (!a) return "";
  const parts = [a.line1, a.line2, a.postalCode, a.provinceState, a.country].filter(Boolean);
  return parts.join(", ");
}

export function CustomersView() {
  const [customers] = useCustomers();
  const [sales] = useSales();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<ClientType>("B2B");
  const [b2bSub, setB2bSub] = useState<"INVOICE" | "DELIVERY_NOTE" | "ALL">("ALL");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomerDraft>(emptyCustomer);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [visibleCount, setVisibleCount] = useState(CUSTOMER_RENDER_BATCH);
  const session = useSession();
  const pendingDeletes = usePendingDeletes();

  // Map customer → set of document types they have been issued.
  const docTypesByCustomer = useMemo(() => {
    const map = new Map<string, Set<SaleDocumentType>>();
    sales.forEach((s) => {
      const d = s.documentType ?? "INVOICE";
      const set = map.get(s.customerId) ?? new Set<SaleDocumentType>();
      set.add(d);
      map.set(s.customerId, set);
    });
    return map;
  }, [sales]);

  const counts = useMemo(() => {
    let b2b = 0, b2c = 0, inv = 0, note = 0;
    customers.forEach((c) => {
      const ct = c.clientType ?? "B2B";
      if (ct === "B2C") b2c++;
      else {
        b2b++;
        const docs = docTypesByCustomer.get(c.id);
        if (docs?.has("DELIVERY_NOTE")) note++;
        if (!docs || docs.has("INVOICE") || docs.size === 0) inv++;
      }
    });
    return { b2b, b2c, inv, note };
  }, [customers, docTypesByCustomer]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers
      .filter((c) => (c.clientType ?? "B2B") === tab)
      .filter((c) => {
        if (tab !== "B2B" || b2bSub === "ALL") return true;
        const docs = docTypesByCustomer.get(c.id);
        if (b2bSub === "DELIVERY_NOTE") return !!docs?.has("DELIVERY_NOTE");
        // INVOICE bucket: customers with invoices, or no sales yet (default for new B2B).
        if (!docs || docs.size === 0) return true;
        return docs.has("INVOICE");
      })
      .filter((c) =>
        !t ||
        [c.id, c.name, c.phone, c.email, c.vatNumber].filter(Boolean).join(" ").toLowerCase().includes(t),
      );
  }, [customers, q, tab, b2bSub, docTypesByCustomer]);
  const visibleCustomers = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const salesStatsByCustomer = useMemo(() => {
    const map = new Map<string, { count: number; total: number; outstanding: number }>();
    sales.forEach((sale) => {
      const current = map.get(sale.customerId) ?? { count: 0, total: 0, outstanding: 0 };
      current.count += 1;
      current.total += sale.total;
      current.outstanding += sale.amountDue ?? 0;
      map.set(sale.customerId, current);
    });
    return map;
  }, [sales]);

  useEffect(() => {
    setVisibleCount(CUSTOMER_RENDER_BATCH);
  }, [q, tab, b2bSub]);

  function openNew() { setDraft(emptyCustomer); setOpen(true); }
  function openEdit(c: Customer) { setDraft(customerToDraft(c)); setOpen(true); }

  async function save() {
    if (!draft.name) { toast.error("Name is required"); return; }
    if (!draft.phoneNumber) { toast.error("Contact phone number is required"); return; }
    customersStore.upsert(composeCustomer(draft));
    try {
      await pushCustomersToCloud();
      toast.success(draft.id ? "Customer updated and saved to cloud" : "Customer added and saved to cloud");
    } catch (error) {
      console.warn("Customer saved locally but cloud push failed", error);
      toast.warning("Customer saved locally. Cloud sync is pending.");
    }
    setOpen(false);
  }

  function remove(c: Customer) {
    if (!session) return;
    if (session.role === "developer") {
      if (!confirm(`Delete "${c.name}"?`)) return;
      customersStore.remove(c.id);
      toast.success("Customer removed");
      setDetail(null);
      return;
    }
    if (!confirm(`Request deletion of "${c.name}"? A developer must approve.`)) return;
    approvalsStore.request(
      { type: "delete_customer", customerId: c.id, customerName: c.name },
      session.username,
    );
    toast.success("Approval request submitted");
    setDetail(null);
  }

  const customerSales = detail ? sales.filter((s) => s.customerId === detail.id) : [];
  const customerOutstanding = customerSales.reduce((a, s) => a + (s.amountDue ?? 0), 0);

  return (
    <>
      <SectionHeader
        title="Customers"
        actions={<Button onClick={openNew}><Plus /> New customer</Button>}
      />

      <div className="mb-3 inline-flex border-2 border-foreground">
        {([
          { id: "B2B", label: "B2B", n: counts.b2b },
          { id: "B2C", label: "B2C", n: counts.b2c },
        ] as { id: ClientType; label: string; n: number }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 text-xs uppercase tracking-[0.2em] transition-colors",
              tab === t.id ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
            )}
          >
            {t.label}
            <span className="ml-2 font-mono-tabular opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "B2B" && (
        <div className="mb-4 inline-flex border border-foreground/40 ml-3">
          {([
            { id: "ALL", label: "All", n: counts.b2b },
            { id: "INVOICE", label: "Invoice clients", n: counts.inv },
            { id: "DELIVERY_NOTE", label: "Delivery-note clients", n: counts.note },
          ] as { id: "ALL" | "INVOICE" | "DELIVERY_NOTE"; label: string; n: number }[]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setB2bSub(t.id)}
              className={cn(
                "px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors",
                b2bSub === t.id ? "bg-foreground text-primary-foreground" : "bg-background hover:bg-secondary",
              )}
            >
              {t.label}
              <span className="ml-2 font-mono-tabular opacity-70">{t.n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 border-2 border-foreground bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by ID, name, phone, VAT…"
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No customers yet" action={<Button onClick={openNew}><Plus /> New customer</Button>} />
      ) : (
        <div className="max-h-[calc(100vh-330px)] min-h-[520px] overflow-y-auto pr-2">
        <div className="grid grid-cols-1 gap-px bg-foreground/10 md:grid-cols-2 lg:grid-cols-3">
          {visibleCustomers.map((c) => {
            const stats = salesStatsByCustomer.get(c.id) ?? { count: 0, total: 0, outstanding: 0 };
            return (
              <button
                key={c.id}
                onClick={() => setDetail(c)}
                className="group relative flex min-h-[206px] flex-col gap-3 border-2 border-transparent bg-background p-5 text-left transition-colors hover:border-foreground"
              >
                 <div className="flex items-start justify-between">
                   <div className="min-w-0 pr-3">
                     <div className="break-words text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                       ID · {c.id} · {c.clientType ?? "B2B"}{c.businessType ? ` · ${c.businessType}` : ""}
                     </div>
                     <h3 className="mt-1 break-words font-display text-xl leading-tight">
                       {[c.name, c.surname].filter(Boolean).join(" ")}
                     </h3>
                     {c.businessName && (
                       <div className="break-words text-xs text-muted-foreground">{c.businessName}</div>
                     )}
                   </div>
                   <span
                     className={
                       "border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] " +
                       ((c.clientType ?? "B2B") === "B2C"
                         ? "bg-accent text-accent-foreground"
                         : "bg-foreground text-primary-foreground")
                     }
                   >
                     {c.clientType ?? "B2B"}
                   </span>
                </div>
                <div className="text-sm text-muted-foreground">{c.phone}</div>
                {c.vatNumber && <div className="text-xs text-muted-foreground">VAT · {c.vatNumber}</div>}
                <div className="mt-2 flex items-center justify-between border-t border-foreground/10 pt-3 text-xs">
                  <span className="text-muted-foreground">{stats.count} sale{stats.count === 1 ? "" : "s"}</span>
                  <span className="font-mono-tabular font-semibold">{fmtMoney(stats.total)}</span>
                </div>
                {stats.outstanding > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-bauhaus-red uppercase tracking-wider font-semibold">Pending</span>
                    <span className="font-mono-tabular font-semibold text-bauhaus-red">{fmtMoney(stats.outstanding)}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {visibleCustomers.length < filtered.length && (
          <div className="sticky bottom-0 mt-px flex items-center justify-between border-2 border-foreground bg-background px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing {visibleCustomers.length} of {filtered.length}. Search to narrow results, or load more.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((count) => count + CUSTOMER_RENDER_BATCH)}
            >
              Load more
            </Button>
          </div>
        )}
        </div>
      )}

      {/* Form dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-none border-2 border-foreground max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{draft.id ? "Edit customer" : "New customer"}</DialogTitle>
          </DialogHeader>
          <CustomerForm value={draft} onChange={setDraft} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{draft.id ? "Save changes" : "Create customer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog with sub-database */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl rounded-none border-2 border-foreground">
          {detail && (
            <>
              <DialogHeader>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Customer · {detail.id} · {detail.clientType ?? "B2B"}{detail.businessType ? ` · ${detail.businessType}` : ""}
                </div>
                <DialogTitle className="font-display text-3xl">
                  {[detail.name, detail.surname].filter(Boolean).join(" ")}
                </DialogTitle>
                {detail.businessName && (
                  <div className="text-sm text-muted-foreground">{detail.businessName}</div>
                )}
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 border-y-2 border-foreground py-4 text-sm md:grid-cols-4">
                <Meta label="Client type" value={detail.clientType ?? "B2B"} />
                <Meta label="Phone" value={detail.phone || "—"} />
                <Meta label="Email" value={detail.email || "—"} />
                <Meta label="VAT" value={detail.vatNumber || "—"} />
                <Meta label="Business type" value={detail.businessType || "—"} />
                <Meta label="Fiscal address" value={formatAddress(detail.fiscalAddress) || detail.address || "—"} />
                <Meta label="Logistics address" value={formatAddress(detail.logisticsAddress) || "—"} />
                <Meta label="Outstanding" value={fmtMoney(customerOutstanding)} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Invoice history</h4>
                  <span className="text-xs text-muted-foreground">{customerSales.length} record{customerSales.length === 1 ? "" : "s"}</span>
                </div>
                {customerSales.length === 0 ? (
                  <div className="border-2 border-dashed border-foreground/20 px-4 py-8 text-center text-sm text-muted-foreground">No invoices yet.</div>
                ) : (
                  <div className="border-2 border-foreground">
                    <table className="w-full text-sm">
                      <thead className="bg-foreground text-primary-foreground text-left">
                        <tr>
                          <th className="px-3 py-2 text-[10px] uppercase tracking-wider">Invoice</th>
                          <th className="px-3 py-2 text-[10px] uppercase tracking-wider">Date</th>
                          <th className="px-3 py-2 text-[10px] uppercase tracking-wider">Items</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider">Total</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider">Paid</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider">Pending</th>
                          <th className="px-3 py-2 text-[10px] uppercase tracking-wider">Status</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {customerSales.map((s) => {
                          const status = s.paymentStatus ?? "PAID";
                          const paid = s.amountPaid ?? (status === "PAID" ? s.total : 0);
                          const due = s.amountDue ?? (s.total - paid);
                          const badge =
                            status === "PAID" ? "bg-foreground text-primary-foreground"
                            : status === "PARTIAL" ? "bg-bauhaus-yellow text-foreground"
                            : "bg-bauhaus-red text-primary-foreground";
                          return (
                          <tr key={s.id} className="border-t border-foreground/10">
                            <td className="px-3 py-2 font-mono-tabular text-xs">{s.invoiceNumber}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                            <td className="px-3 py-2 text-xs">{s.lines.reduce((a, l) => a + l.quantity, 0)}</td>
                            <td className="px-3 py-2 text-right font-mono-tabular">{fmtMoney(s.total)}</td>
                            <td className="px-3 py-2 text-right font-mono-tabular">{fmtMoney(paid)}</td>
                            <td className={"px-3 py-2 text-right font-mono-tabular " + (due > 0 ? "text-bauhaus-red font-semibold" : "")}>{fmtMoney(due)}</td>
                            <td className="px-3 py-2">
                              <span className={"border-2 border-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] " + badge}>{status}</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => generateInvoicePdf(s)}
                                disabled={status !== "PAID"}
                                title={
                                  status !== "PAID"
                                    ? "Document will be available once fully paid"
                                    : undefined
                                }
                              ><FileText /> PDF</Button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <DialogFooter>
                {pendingDeletes.customers.has(detail.id) ? (
                  <Button variant="ghost" disabled title="Awaiting developer approval">
                    <Trash2 /> Pending approval
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => remove(detail)}>
                    <Trash2 /> Delete
                  </Button>
                )}
                <Button variant="outline" onClick={() => { openEdit(detail); setDetail(null); }}><Pencil /> Edit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm">{value}</div>
    </div>
  );
}
