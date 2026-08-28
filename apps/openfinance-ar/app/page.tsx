const invoices = [
  { id: "INV-10482", amount: "$18,420", po: "PO-8821", status: "Ready" },
  { id: "INV-10491", amount: "$7,250", po: "PO-8844", status: "Ready" },
  { id: "INV-10503", amount: "$12,900", po: "Missing", status: "Needs attention" },
];

export default function OpenFinanceHome() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OpenFinance</p>
          <h1>Portal delivery</h1>
        </div>
        <div className="identity" aria-label="Signed-in organization">
          <span>Sarah Cohen</span>
          <small>Example Supplier Ltd</small>
        </div>
      </header>

      <section className="summary" aria-labelledby="summary-title">
        <div>
          <p className="eyebrow">Acme Manufacturing</p>
          <h2 id="summary-title">Three invoices need portal review</h2>
          <p>Prepare, validate, and track delivery to your customer’s AP portal.</p>
        </div>
        <div className="metric"><strong>2</strong><span>Ready</span></div>
        <div className="metric attention"><strong>1</strong><span>Exception</span></div>
      </section>

      <section className="panel" aria-labelledby="invoice-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Invoice queue</p>
            <h2 id="invoice-title">Customer portal submissions</h2>
          </div>
          <span className="agent-ready">WebMCP ready</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Amount</th><th>Purchase order</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td><strong>{invoice.id}</strong></td>
                  <td>{invoice.amount}</td>
                  <td>{invoice.po}</td>
                  <td><span className={invoice.status === "Ready" ? "badge ready" : "badge blocked"}>{invoice.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
