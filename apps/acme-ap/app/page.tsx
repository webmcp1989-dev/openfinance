const purchaseOrders = [
  { id: "PO-8821", description: "Product implementation", remaining: "$24,000", status: "Open" },
  { id: "PO-8844", description: "Platform subscription", remaining: "$7,250", status: "Open" },
  { id: "PO-8890", description: "Advisory services", remaining: "$10,000", status: "Open" },
];

export default function AcmeHome() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div className="wordmark"><span className="mark">A</span><span>Acme Supplier Portal</span></div>
        <nav aria-label="Primary navigation"><a href="#orders">Purchase orders</a><a href="#submissions">Invoices</a></nav>
        <div className="supplier"><small>Signed in as</small><strong>Example Supplier Ltd</strong><span>SUP-8821</span></div>
      </header>

      <section className="intro">
        <div>
          <p className="kicker">Accounts payable</p>
          <h1>Supplier workspace</h1>
          <p>Review purchase orders, submit invoices, and track approval status.</p>
        </div>
        <span className="tool-status">Agent tools available</span>
      </section>

      <section className="requirements" aria-labelledby="requirements-title">
        <div><p className="kicker">Submission policy</p><h2 id="requirements-title">Invoice requirements</h2></div>
        <ul><li>Valid open PO</li><li>Invoice PDF</li><li>Unique invoice number</li><li>Amount within PO balance</li></ul>
      </section>

      <section className="orders" id="orders" aria-labelledby="orders-title">
        <div className="section-heading"><div><p className="kicker">Authorized supplier data</p><h2 id="orders-title">Purchase orders</h2></div><span>3 open</span></div>
        <div className="cards">
          {purchaseOrders.map((order) => (
            <article key={order.id} className="order-card">
              <div><strong>{order.id}</strong><span>{order.status}</span></div>
              <p>{order.description}</p>
              <small>Remaining balance</small>
              <h3>{order.remaining}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
