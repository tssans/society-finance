import { useState, useEffect, useCallback } from "react";

// ── Supabase config ────────────────────────────────────────────────────────
const SUPABASE_URL = "https://dbcwacawuwzsenuvjxhj.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiY3dhY2F3dXd6c2VudXZqeGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMTg0OTIsImV4cCI6MjA5Mzg5NDQ5Mn0.JhIwGVFzSesxJmcC3AaxAcX0jg29zMVeExraU6pl164";
const BUCKET = "attachments";

const api = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

const storage = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res;
};

// ── constants ──────────────────────────────────────────────────────────────
const ACCOUNTS = [
  { id: "acc-ops",    name: "Operations Account", shortName: "OPS", description: "All operational income and expenses — maintenance collections, repairs, utilities, security, and day-to-day running costs.", color: "#6366f1", bg: "#eef2ff", icon: "⚙️" },
  { id: "acc-var",    name: "Variable Account",   shortName: "VAR", description: "Income from club house bookings, guest room rentals, event spaces, and other variable or ad-hoc sources.",                color: "#0ea5e9", bg: "#e0f2fe", icon: "🏠" },
  { id: "acc-temple", name: "Temple Account",     shortName: "TPL", description: "Dedicated fund for temple income (donations, festivals) and expenses (prasad, maintenance, decorations, priest fees).",   color: "#f59e0b", bg: "#fffbeb", icon: "🛕" },
];
const ACC_MAP = Object.fromEntries(ACCOUNTS.map(a => [a.id, a]));

const INCOME_CATS  = ["Maintenance","Parking","Club House","Guest Room","Donation","Festival","Late Fee","Other"];
const EXPENSE_CATS = ["Maintenance Work","Electricity","Water","Security","Cleaning","Admin","Events","Prasad","Priest Fee","Decoration","Other"];
const FEEDBACK_TYPES = ["Bug / Error", "New Feature", "Improvement", "General"];

const fmt = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtDate = d => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const today = () => new Date().toISOString().split("T")[0];

const emptyTx = (type) => ({
  type, account_id: ACCOUNTS[0].id, date: today(),
  amount: "", category: type === "income" ? INCOME_CATS[0] : EXPENSE_CATS[0],
  description: "", ref: "",
});

const emptyFeedback = () => ({ submitted_by: "", type: FEEDBACK_TYPES[0], message: "" });

// ── CSV ────────────────────────────────────────────────────────────────────
function exportCSV(txs) {
  const rows = [["Date","Account","Type","Category","Description","Reference","Amount (INR)"]];
  txs.forEach(e => rows.push([e.date, ACC_MAP[e.account_id]?.name || "", e.type, e.category, e.description, e.ref, e.amount]));
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `society-finance-${today()}.csv`;
  a.click();
}

// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab]           = useState("dashboard");
  const [activeNav, setActiveNav] = useState("dashboard");
  const [txs, setTxs]           = useState([]);
  const [attachments, setAttachments] = useState({}); // txId -> []
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState(null);
  const [newFiles, setNewFiles] = useState([]);        // files staged for upload
  const [saving, setSaving]     = useState(false);
  const [filter, setFilter]     = useState({ type: "all", cat: "all", month: "", accountId: "all" });
  const [tooltip, setTooltip]   = useState(null);
  const [toast, setToast]       = useState(null);
  const [feedback, setFeedback] = useState(emptyFeedback());
  const [feedbackList, setFeedbackList] = useState([]);
  const [fbSaving, setFbSaving] = useState(false);
  const [expandedTx, setExpandedTx] = useState(null); // txId showing attachments

  // ── load ──────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, fb] = await Promise.all([
        api("transactions?select=*&order=date.desc,created_at.desc"),
        api("feedback?select=*&order=created_at.desc"),
      ]);
      setTxs(t);
      setFeedbackList(fb);
    } catch (e) { showToast("Failed to load data: " + e.message, false); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadAttachments = async (txId) => {
    if (attachments[txId]) return; // already loaded
    try {
      const data = await api(`attachments?transaction_id=eq.${txId}&select=*`);
      setAttachments(prev => ({ ...prev, [txId]: data }));
    } catch {}
  };

  // ── toast ─────────────────────────────────────────────────────────────────
  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  // ── save transaction ──────────────────────────────────────────────────────
  const saveTx = async () => {
    if (!form.amount || isNaN(form.amount) || +form.amount <= 0) { showToast("Enter a valid amount", false); return; }
    setSaving(true);
    try {
      let txId = form.id;
      if (txId) {
        // update
        await api(`transactions?id=eq.${txId}`, {
          method: "PATCH",
          body: JSON.stringify({ type: form.type, account_id: form.account_id, date: form.date, amount: +form.amount, category: form.category, description: form.description, ref: form.ref }),
        });
      } else {
        // insert
        const [created] = await api("transactions", {
          method: "POST",
          body: JSON.stringify({ type: form.type, account_id: form.account_id, date: form.date, amount: +form.amount, category: form.category, description: form.description, ref: form.ref }),
        });
        txId = created.id;
      }

      // upload files
      for (const file of newFiles) {
        const ext = file.name.split(".").pop();
        const path = `${txId}/${Date.now()}.${ext}`;
        const formData = new FormData();
        formData.append("", file);
        await storage(`object/${BUCKET}/${path}`, { method: "POST", body: formData, headers: {} });
        const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
        await api("attachments", {
          method: "POST",
          body: JSON.stringify({ transaction_id: txId, file_name: file.name, file_url: fileUrl }),
        });
      }

      // clear attachment cache for this tx so it reloads
      setAttachments(prev => { const n = { ...prev }; delete n[txId]; return n; });
      setNewFiles([]);
      setForm(null);
      setTab("ledger");
      setActiveNav("ledger");
      showToast("Entry saved ✓");
      await loadAll();
    } catch (e) { showToast("Save failed: " + e.message, false); }
    setSaving(false);
  };

  // ── delete transaction ────────────────────────────────────────────────────
  const deleteTx = async (id) => {
    try {
      await api(`transactions?id=eq.${id}`, { method: "DELETE" });
      setTxs(prev => prev.filter(t => t.id !== id));
      showToast("Entry deleted");
    } catch (e) { showToast("Delete failed", false); }
  };

  // ── delete attachment ─────────────────────────────────────────────────────
  const deleteAttachment = async (att, txId) => {
    try {
      const path = att.file_url.split(`/object/public/${BUCKET}/`)[1];
      await storage(`object/${BUCKET}/${path}`, { method: "DELETE" });
      await api(`attachments?id=eq.${att.id}`, { method: "DELETE" });
      setAttachments(prev => ({ ...prev, [txId]: prev[txId].filter(a => a.id !== att.id) }));
      showToast("Attachment deleted");
    } catch { showToast("Could not delete attachment", false); }
  };

  // ── submit feedback ───────────────────────────────────────────────────────
  const submitFeedback = async () => {
    if (!feedback.message.trim()) { showToast("Please enter a message", false); return; }
    setFbSaving(true);
    try {
      await api("feedback", { method: "POST", body: JSON.stringify(feedback) });
      showToast("Feedback submitted ✓");
      setFeedback(emptyFeedback());
      const fb = await api("feedback?select=*&order=created_at.desc");
      setFeedbackList(fb);
    } catch (e) { showToast("Submit failed: " + e.message, false); }
    setFbSaving(false);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const totalInc = txs.filter(e => e.type === "income").reduce((s, e) => s + +e.amount, 0);
  const totalExp = txs.filter(e => e.type === "expense").reduce((s, e) => s + +e.amount, 0);

  const accStats = id => {
    const inc = txs.filter(e => e.account_id === id && e.type === "income").reduce((s, e) => s + +e.amount, 0);
    const exp = txs.filter(e => e.account_id === id && e.type === "expense").reduce((s, e) => s + +e.amount, 0);
    return { inc, exp, bal: inc - exp };
  };

  const filtered = txs.filter(e => {
    if (filter.type !== "all" && e.type !== filter.type) return false;
    if (filter.cat !== "all" && e.category !== filter.cat) return false;
    if (filter.month && !e.date.startsWith(filter.month)) return false;
    if (filter.accountId !== "all" && e.account_id !== filter.accountId) return false;
    return true;
  });

  const navTo = k => {
    setActiveNav(k);
    if (k === "income")  { setForm(emptyTx("income"));  setNewFiles([]); setTab("form"); }
    else if (k === "expense") { setForm(emptyTx("expense")); setNewFiles([]); setTab("form"); }
    else setTab(k);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#f4f5f9" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:44, color:"#6366f1" }}>◈</div>
        <p style={{ color:"#6b7280", marginTop:8 }}>Connecting to Supabase…</p>
      </div>
    </div>
  );

  return (
    <div style={S.root} onClick={() => tooltip && setTooltip(null)}>

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.brand}>
            <span style={{ fontSize:24, color:"#818cf8" }}>◈</span>
            <div>
              <div style={S.brandName}>Society Finance</div>
              <div style={S.brandSub}>Live · Supabase</div>
            </div>
          </div>
          <button style={S.btnExport} onClick={() => exportCSV(filtered)}>↓ CSV</button>
        </div>
      </header>

      {/* NAV */}
      <nav style={S.nav}>
        {[["dashboard","Dashboard"],["accounts","Accounts"],["ledger","Ledger"],["income","+ Income"],["expense","+ Expense"],["feedback","Feedback"]].map(([k,label]) => (
          <button key={k} style={{ ...S.navBtn, ...(activeNav===k ? S.navActive : {}) }} onClick={() => navTo(k)}>{label}</button>
        ))}
      </nav>

      <main style={S.main}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div>
            <div style={S.kpiRow}>
              <KPI label="Total Income"   value={fmt(totalInc)}          color="#22c55e" icon="↑" />
              <KPI label="Total Expenses" value={fmt(totalExp)}          color="#f97316" icon="↓" />
              <KPI label="Net Balance"    value={fmt(totalInc-totalExp)} color={(totalInc-totalExp)>=0?"#6366f1":"#f43f5e"} icon="=" />
            </div>

            <div style={S.groupLabel}>Accounts Overview</div>
            {ACCOUNTS.map(acc => {
              const { inc, exp, bal } = accStats(acc.id);
              const pct = inc > 0 ? Math.min((exp/inc)*100,100) : 0;
              return (
                <div key={acc.id} style={{ ...S.accCard, borderLeft:`4px solid ${acc.color}` }}>
                  <div style={S.accCardTop}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:26 }}>{acc.icon}</span>
                      <div>
                        <div style={S.accName}>{acc.name}</div>
                        <span style={{ ...S.badge, background:acc.bg, color:acc.color }}>{acc.shortName}</span>
                      </div>
                    </div>
                    <button style={S.infoBtn} onClick={ev => { ev.stopPropagation(); setTooltip(tooltip===acc.id?null:acc.id); }}>ⓘ</button>
                  </div>
                  {tooltip===acc.id && <div style={S.tooltip}>{acc.description}</div>}
                  <div style={S.statRow}>
                    <Stat label="Income"   value={fmt(inc)} color="#22c55e" />
                    <div style={S.statDiv}/>
                    <Stat label="Expenses" value={fmt(exp)} color="#f97316" />
                    <div style={S.statDiv}/>
                    <Stat label="Balance"  value={fmt(bal)} color={bal>=0?acc.color:"#f43f5e"} />
                  </div>
                  <div style={S.miniTrack}><div style={{ ...S.miniFill, width:`${pct}%`, background:acc.color }}/></div>
                  <div style={S.miniLabel}>{inc>0?`${Math.round(pct)}% of income spent`:"No income recorded yet"}</div>
                </div>
              );
            })}

            <div style={S.groupLabel}>Recent Transactions</div>
            <div style={S.card}>
              {txs.length===0 && <Empty text="No transactions yet." />}
              {txs.slice(0,6).map(e => (
                <TxRow key={e.id} e={e} acc={ACC_MAP[e.account_id]}
                  expanded={expandedTx===e.id}
                  attachments={attachments[e.id]}
                  onExpand={() => { setExpandedTx(expandedTx===e.id?null:e.id); loadAttachments(e.id); }}
                  onEdit={() => { setForm({...e}); setNewFiles([]); setTab("form"); setActiveNav(""); }}
                  onDelete={() => { if(confirm("Delete this entry?")) deleteTx(e.id); }}
                  onDeleteAtt={(att) => deleteAttachment(att, e.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ═══ ACCOUNTS ═══ */}
        {tab === "accounts" && (
          <div>
            <div style={S.pageTitle}>Accounts</div>
            {ACCOUNTS.map(acc => {
              const { inc, exp, bal } = accStats(acc.id);
              const txCount = txs.filter(e => e.account_id===acc.id).length;
              return (
                <div key={acc.id} style={{ ...S.accDetailCard, borderTop:`3px solid ${acc.color}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                    <span style={{ fontSize:30 }}>{acc.icon}</span>
                    <div>
                      <div style={S.accDetailName}>{acc.name}</div>
                      <span style={{ ...S.badge, background:acc.bg, color:acc.color }}>{acc.shortName}</span>
                    </div>
                  </div>
                  <div style={S.accDesc}>{acc.description}</div>
                  <div style={S.statRow}>
                    <Stat label="Income"   value={fmt(inc)} color="#22c55e" />
                    <div style={S.statDiv}/>
                    <Stat label="Expenses" value={fmt(exp)} color="#f97316" />
                    <div style={S.statDiv}/>
                    <Stat label="Balance"  value={fmt(bal)} color={bal>=0?acc.color:"#f43f5e"} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12 }}>
                    <span style={{ fontSize:12, color:"#9ca3af" }}>{txCount} transaction{txCount!==1?"s":""}</span>
                    <button style={{ ...S.viewBtn, color:acc.color, borderColor:acc.color }}
                      onClick={() => { setFilter(f=>({...f,accountId:acc.id})); navTo("ledger"); }}>
                      View Ledger →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ LEDGER ═══ */}
        {tab === "ledger" && (
          <div>
            <div style={S.pageTitle}>Ledger</div>
            <div style={S.filterCol}>
              <select style={S.select} value={filter.accountId} onChange={e=>setFilter(f=>({...f,accountId:e.target.value}))}>
                <option value="all">All Accounts</option>
                {ACCOUNTS.map(a=><option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
              </select>
              <select style={S.select} value={filter.type} onChange={e=>setFilter(f=>({...f,type:e.target.value}))}>
                <option value="all">All Types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
              <select style={S.select} value={filter.cat} onChange={e=>setFilter(f=>({...f,cat:e.target.value}))}>
                <option value="all">All Categories</option>
                {[...INCOME_CATS,...EXPENSE_CATS].filter((v,i,a)=>a.indexOf(v)===i).map(c=><option key={c}>{c}</option>)}
              </select>
              <input type="month" style={S.select} value={filter.month} onChange={e=>setFilter(f=>({...f,month:e.target.value}))}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, color:"#9ca3af" }}>{filtered.length} records</span>
              <span style={{ fontSize:13 }}>Net: <strong style={{ color:filtered.reduce((s,e)=>e.type==="income"?s+ +e.amount:s- +e.amount,0)>=0?"#22c55e":"#f43f5e" }}>
                {fmt(filtered.reduce((s,e)=>e.type==="income"?s+ +e.amount:s- +e.amount,0))}
              </strong></span>
            </div>
            <div style={S.card}>
              {filtered.length===0 && <Empty text="No records match the selected filters." />}
              {filtered.map(e=>(
                <TxRow key={e.id} e={e} acc={ACC_MAP[e.account_id]}
                  expanded={expandedTx===e.id}
                  attachments={attachments[e.id]}
                  onExpand={() => { setExpandedTx(expandedTx===e.id?null:e.id); loadAttachments(e.id); }}
                  onEdit={() => { setForm({...e}); setNewFiles([]); setTab("form"); setActiveNav(""); }}
                  onDelete={() => { if(confirm("Delete this entry?")) deleteTx(e.id); }}
                  onDeleteAtt={(att) => deleteAttachment(att, e.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ═══ FORM ═══ */}
        {tab === "form" && form && (
          <div style={S.formCard}>
            <div style={S.formTitle}>{form.id ? "Edit" : "New"} {form.type==="income"?"Income":"Expense"}</div>

            <Fld label="Account">
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                {ACCOUNTS.map(acc=>(
                  <button key={acc.id} style={{ ...S.accChip, background:form.account_id===acc.id?acc.color:acc.bg, color:form.account_id===acc.id?"#fff":acc.color, border:`1.5px solid ${acc.color}` }}
                    onClick={()=>setForm(f=>({...f,account_id:acc.id}))}>
                    {acc.icon} {acc.shortName}
                  </button>
                ))
