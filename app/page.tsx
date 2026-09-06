"use client";

import { useState, useEffect } from "react";

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  color: string;
  description: string;
  stats: {
    totalKeys: number;
    activeKeys: number;
    rateLimitedKeys: number;
    totalUsage: number;
  };
  defaultModels: string[];
};

type ApiKey = {
  id: string;
  name: string;
  provider: string;
  maskedKey: string;
  isActive: boolean;
  isValid: boolean;
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsed: string | null;
  rateLimitedUntil: string | null;
  createdAt: string;
  customBaseUrl?: string;
  notes?: string;
};

type Log = {
  id: string;
  timestamp: string;
  provider: string;
  model?: string;
  keyName: string;
  status: number;
  latency: number;
  success: boolean;
  error?: string;
  path: string;
  method: string;
  retryCount?: number;
};

type Stats = {
  stats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    rateLimitedRequests: number;
    providerStats: Record<string, any>;
  };
  overview: {
    totalKeys: number;
    activeKeys: number;
    validKeys: number;
    rateLimitedKeys: number;
    providers: number;
  };
};

export default function Dashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [showAddKey, setShowAddKey] = useState(false);
  const [newKey, setNewKey] = useState({ name: "", provider: "openai", key: "", customBaseUrl: "", notes: "" });
  const [activeTab, setActiveTab] = useState<"overview" | "keys" | "logs" | "docs">("overview");
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Check auth
  useEffect(() => {
    fetch("/api/auth")
      .then(r => r.json())
      .then(d => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        setAuthenticated(true);
        loadData();
      } else {
        setLoginError(data.error || "Invalid password");
      }
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthenticated(false);
  };

  const loadData = async () => {
    try {
      const [provRes, keysRes, logsRes, statsRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/keys"),
        fetch("/api/logs?limit=50"),
        fetch("/api/stats"),
      ]);

      if (provRes.ok) {
        const d = await provRes.json();
        setProviders(d.providers || []);
      }
      if (keysRes.ok) {
        const d = await keysRes.json();
        setKeys(d.keys || []);
      }
      if (logsRes.ok) {
        const d = await logsRes.json();
        setLogs(d.logs || []);
      }
      if (statsRes.ok) {
        const d = await statsRes.json();
        setStats(d);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (authenticated) loadData();
  }, [authenticated]);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newKey),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddKey(false);
        setNewKey({ name: "", provider: "openai", key: "", customBaseUrl: "", notes: "" });
        loadData();
      } else {
        alert(data.error || "Failed to add key");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm("Delete this key?")) return;
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok) loadData();
    else alert("Failed to delete");
  };

  const handleToggleKey = async (key: ApiKey) => {
    const res = await fetch(`/api/keys/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !key.isActive }),
    });
    if (res.ok) loadData();
  };

  const handleTestKey = async (id: string) => {
    setTestingKey(id);
    try {
      const res = await fetch(`/api/keys/${id}?action=test`, { method: "POST" });
      const data = await res.json();
      alert(data.valid ? `✅ ${data.message}` : `❌ ${data.error}\n${data.details || ""}`);
      loadData();
    } catch (e: any) {
      alert(`Test failed: ${e.message}`);
    }
    setTestingKey(null);
  };

  const handleClearRateLimit = async (key: ApiKey) => {
    const res = await fetch(`/api/keys/${key.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearRateLimit: true, isValid: true }),
    });
    if (res.ok) loadData();
  };

  const filteredKeys = keys.filter(k => {
    if (selectedProvider !== "all" && k.provider !== selectedProvider) return false;
    if (searchQuery && !k.name.toLowerCase().includes(searchQuery.toLowerCase()) && !k.provider.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const filteredLogs = logs.filter(l => {
    if (selectedProvider !== "all" && l.provider !== selectedProvider) return false;
    return true;
  });

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa]">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center">
                <span className="text-white font-bold text-lg">◈</span>
              </div>
              <div>
                <h1 className="font-semibold text-lg leading-none">AI Router</h1>
                <p className="text-xs text-gray-500 mt-1">Multi-key management</p>
              </div>
            </div>

            <h2 className="text-xl font-semibold mb-2">Welcome back</h2>
            <p className="text-sm text-gray-500 mb-6">Enter admin password to access dashboard. Default is <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">admin</code></p>

            <form onSubmit={login} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Admin Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                  autoFocus
                />
              </div>

              {loginError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors"
              >
                Sign in
              </button>

              <div className="pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-2">
                <p>💡 Set <code className="bg-gray-100 px-1 py-0.5 rounded">ADMIN_PASSWORD</code> env var for production.</p>
                <p>🔒 Keys are encrypted with <code className="bg-gray-100 px-1 py-0.5 rounded">ENCRYPTION_KEY</code></p>
              </div>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">Deployable to Vercel in one click • Supports 12+ providers</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-gray-200">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-[64px]">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                  <span className="text-white font-bold">◈</span>
                </div>
                <div>
                  <h1 className="font-semibold text-[15px] leading-none tracking-tight">AI Router</h1>
                  <p className="text-[11px] text-gray-500 font-medium">PROXY • ROTATION • RATE LIMIT</p>
                </div>
              </div>

              <div className="hidden lg:flex items-center gap-1 bg-gray-100 p-1 rounded-full">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "keys", label: "Keys" },
                  { id: "logs", label: "Logs" },
                  { id: "docs", label: "API Docs" },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${
                      activeTab === tab.id ? "bg-white shadow-sm text-black" : "text-gray-600 hover:text-black"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  {stats?.overview.activeKeys || 0} active
                </div>
                <div className="px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-600">
                  {stats?.stats.totalRequests || 0} requests
                </div>
              </div>

              <button
                onClick={loadData}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              <button
                onClick={logout}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Mobile tabs */}
          <div className="lg:hidden flex items-center gap-1 pb-3">
            {[
              { id: "overview", label: "Overview" },
              { id: "keys", label: "Keys" },
              { id: "logs", label: "Logs" },
              { id: "docs", label: "Docs" },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-2 rounded-full text-[13px] font-medium transition-all ${
                  activeTab === tab.id ? "bg-black text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar - Providers */}
          <div className="lg:w-[300px] shrink-0 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm">Providers</h2>
                <button
                  onClick={() => setSelectedProvider("all")}
                  className={`text-xs px-2.5 py-1 rounded-full border ${selectedProvider === "all" ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"}`}
                >
                  All
                </button>
              </div>

              <div className="space-y-1.5">
                {providers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center gap-3 ${
                      selectedProvider === p.id ? "bg-black text-white border-black" : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: selectedProvider === p.id ? "white" : p.color, color: selectedProvider === p.id ? "black" : "white" }}>
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[13px] truncate">{p.name}</span>
                        {p.stats.activeKeys > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${selectedProvider === p.id ? "bg-white/20 text-white" : "bg-green-100 text-green-700"}`}>
                            {p.stats.activeKeys}
                          </span>
                        )}
                      </div>
                      <div className={`text-[11px] truncate ${selectedProvider === p.id ? "text-white/70" : "text-gray-500"}`}>
                        {p.stats.totalUsage} uses • {p.stats.totalKeys} keys
                      </div>
                    </div>
                    {p.stats.rateLimitedKeys > 0 && (
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Rate limited keys" />
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-[11px] text-gray-500 space-y-1">
                  <div className="flex justify-between"><span>Total keys</span><span className="font-medium text-gray-900">{stats?.overview.totalKeys || 0}</span></div>
                  <div className="flex justify-between"><span>Rate limited</span><span className="font-medium text-amber-600">{stats?.overview.rateLimitedKeys || 0}</span></div>
                  <div className="flex justify-between"><span>Success rate</span><span className="font-medium text-green-600">{stats ? ((stats.stats.successfulRequests / Math.max(1, stats.stats.totalRequests)) * 100).toFixed(1) + "%" : "0%"}</span></div>
                </div>
              </div>
            </div>

            {/* Quick stats */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <h3 className="font-semibold text-sm mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setShowAddKey(true)}
                  className="w-full py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-900 flex items-center justify-center gap-2"
                >
                  <span>+</span> Add API Key
                </button>
                <button
                  onClick={() => { if (confirm("Clear all logs and stats?")) fetch("/api/stats", { method: "DELETE" }).then(() => loadData()); }}
                  className="w-full py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50"
                >
                  Clear Logs
                </button>
              </div>

              <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs font-medium text-amber-900">💡 Pro tip</p>
                <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">Add multiple keys per provider. Router automatically rotates and handles 429s.</p>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-6">
            {activeTab === "overview" && (
              <>
                {/* Stats grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Total Requests</div>
                    <div className="text-2xl font-semibold mt-1">{stats?.stats.totalRequests || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">{stats?.stats.successfulRequests || 0} success • {stats?.stats.failedRequests || 0} failed</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Active Keys</div>
                    <div className="text-2xl font-semibold mt-1">{stats?.overview.activeKeys || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">{stats?.overview.totalKeys || 0} total • {stats?.overview.validKeys || 0} valid</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Rate Limited</div>
                    <div className="text-2xl font-semibold mt-1 text-amber-600">{stats?.stats.rateLimitedRequests || 0}</div>
                    <div className="text-xs text-gray-500 mt-1">{stats?.overview.rateLimitedKeys || 0} keys currently limited</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Providers</div>
                    <div className="text-2xl font-semibold mt-1">{providers.filter(p => p.stats.totalKeys > 0).length}</div>
                    <div className="text-xs text-gray-500 mt-1">{providers.length} supported • {Object.keys(stats?.stats.providerStats || {}).length} used</div>
                  </div>
                </div>

                {/* Provider health */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Provider Health</h3>
                    <span className="text-xs text-gray-500">{providers.filter(p => p.stats.activeKeys > 0).length} active</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {providers.filter(p => p.stats.totalKeys > 0).map(p => (
                      <div key={p.id} className="p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs" style={{ background: p.color }}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{p.name}</span>
                            <span className="text-xs text-gray-500">{p.stats.totalKeys} keys</span>
                            {p.stats.rateLimitedKeys > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{p.stats.rateLimitedKeys} rate limited</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[200px]">
                              <div className="h-full bg-black rounded-full" style={{ width: `${Math.min(100, (p.stats.activeKeys / Math.max(1, p.stats.totalKeys)) * 100)}%` }} />
                            </div>
                            <span className="text-xs text-gray-500">{p.stats.totalUsage} requests</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium">{p.stats.activeKeys}/{p.stats.totalKeys} active</div>
                          <div className="text-[11px] text-gray-500">{p.description.slice(0, 40)}</div>
                        </div>
                      </div>
                    ))}
                    {providers.filter(p => p.stats.totalKeys > 0).length === 0 && (
                      <div className="p-8 text-center">
                        <div className="text-3xl mb-2">🔑</div>
                        <p className="text-sm font-medium">No keys yet</p>
                        <p className="text-xs text-gray-500 mt-1">Add your first API key to get started</p>
                        <button onClick={() => setShowAddKey(true)} className="mt-3 px-4 py-2 rounded-full bg-black text-white text-xs font-medium">Add Key</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent logs */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Recent Requests</h3>
                    <button onClick={() => setActiveTab("logs")} className="text-xs text-gray-500 hover:text-black">View all →</button>
                  </div>
                  <div className="divide-y divide-gray-100 max-h-[400px] overflow-auto">
                    {filteredLogs.slice(0, 10).map(log => (
                      <div key={log.id} className="p-3 flex items-center gap-3 text-xs">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${log.success ? "bg-green-500" : log.status === 429 ? "bg-amber-500" : "bg-red-500"}`} />
                        <span className="font-mono text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 font-medium">{log.provider}</span>
                        <span className="truncate flex-1">{log.model || log.path}</span>
                        <span className={`px-1.5 py-0.5 rounded font-mono ${log.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{log.status}</span>
                        <span className="text-gray-500">{log.latency}ms</span>
                      </div>
                    ))}
                    {filteredLogs.length === 0 && (
                      <div className="p-8 text-center text-sm text-gray-500">No requests yet. Try the proxy endpoints!</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "keys" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-sm">API Keys</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{filteredKeys.length} keys • Auto rotation & rate limit handling</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Search keys..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="px-3 py-1.5 rounded-full border border-gray-200 text-xs w-[160px] focus:outline-none focus:ring-2 focus:ring-black"
                    />
                    <button onClick={() => setShowAddKey(true)} className="px-3 py-1.5 rounded-full bg-black text-white text-xs font-medium">+ Add</button>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">
                  {filteredKeys.map(k => {
                    const isRateLimited = k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now();
                    const rateLimitExpiry = isRateLimited ? Math.ceil((new Date(k.rateLimitedUntil!).getTime() - Date.now()) / 1000) : 0;

                    return (
                      <div key={k.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${!k.isActive ? "bg-gray-300" : !k.isValid ? "bg-red-500" : isRateLimited ? "bg-amber-500" : "bg-green-500"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{k.name}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">{k.provider}</span>
                              {isRateLimited && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">⏳ {rateLimitExpiry}s</span>}
                              {!k.isValid && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Invalid</span>}
                              {!k.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Disabled</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span className="font-mono">{k.maskedKey}</span>
                              <span>{k.usageCount} uses</span>
                              <span className="text-green-600">{k.successCount} ok</span>
                              {k.failureCount > 0 && <span className="text-red-600">{k.failureCount} fail</span>}
                              {k.lastUsed && <span>{new Date(k.lastUsed).toLocaleDateString()}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 lg:ml-4">
                          <button
                            onClick={() => handleTestKey(k.id)}
                            disabled={testingKey === k.id}
                            className="px-2.5 py-1 rounded-full border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            {testingKey === k.id ? "..." : "Test"}
                          </button>
                          {isRateLimited && (
                            <button onClick={() => handleClearRateLimit(k)} className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs hover:bg-amber-100">
                              Clear limit
                            </button>
                          )}
                          <button onClick={() => handleToggleKey(k)} className={`px-2.5 py-1 rounded-full text-xs border ${k.isActive ? "border-gray-200 hover:bg-gray-50" : "bg-black text-white border-black"}`}>
                            {k.isActive ? "Disable" : "Enable"}
                          </button>
                          <button onClick={() => handleDeleteKey(k.id)} className="px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 text-xs hover:bg-red-100">
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {filteredKeys.length === 0 && (
                    <div className="p-12 text-center">
                      <div className="text-3xl mb-3">🔍</div>
                      <p className="text-sm font-medium">No keys found</p>
                      <p className="text-xs text-gray-500 mt-1">{searchQuery || selectedProvider !== "all" ? "Try adjusting filters" : "Add your first API key"}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "logs" && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="font-semibold text-sm">Request Logs</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Last {filteredLogs.length} requests • Auto rotation tracking</p>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="text-left p-3">Time</th>
                        <th className="text-left p-3">Provider</th>
                        <th className="text-left p-3">Model / Path</th>
                        <th className="text-left p-3">Key</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-left p-3">Latency</th>
                        <th className="text-left p-3">Retries</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredLogs.map(log => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="p-3 font-mono text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-gray-100">{log.provider}</span></td>
                          <td className="p-3 max-w-[200px] truncate" title={log.model || log.path}>{log.model || log.path}</td>
                          <td className="p-3">{log.keyName}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded-full font-mono ${log.success ? "bg-green-100 text-green-700" : log.status === 429 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{log.status}</span></td>
                          <td className="p-3 font-mono">{log.latency}ms</td>
                          <td className="p-3">{log.retryCount || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredLogs.length === 0 && (
                    <div className="p-12 text-center text-sm text-gray-500">No logs yet</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "docs" && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl border border-gray-200 p-6">
                  <h3 className="font-semibold text-base mb-2">🚀 Quick Start</h3>
                  <p className="text-sm text-gray-600 mb-4">Your AI Router is live. Use these endpoints to proxy requests with automatic key rotation.</p>

                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-sm mb-2">OpenAI Compatible (Recommended)</h4>
                      <div className="bg-gray-950 text-gray-100 rounded-xl p-4 overflow-auto">
                        <pre className="text-xs leading-relaxed">
{`curl https://your-domain.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-AI-Provider: openai" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Python
import openai
client = openai.OpenAI(
  base_url="https://your-domain.vercel.app/api/v1",
  api_key="not-needed-but-required"
)
# Use X-AI-Provider header or provider query param
response = client.chat.completions.create(
  model="gpt-4o-mini",
  messages=[{"role": "user", "content": "Hello"}],
  extra_headers={"X-AI-Provider": "openai"}
)`}
                        </pre>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">Provider-Specific Proxy</h4>
                      <div className="bg-gray-950 text-gray-100 rounded-xl p-4 overflow-auto">
                        <pre className="text-xs leading-relaxed">
{`# OpenAI
curl https://your-domain.vercel.app/api/proxy/openai/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","messages":[...]}'

# Anthropic
curl https://your-domain.vercel.app/api/proxy/anthropic/v1/messages \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1000,"messages":[...]}'

# Groq (OpenAI compatible)
curl https://your-domain.vercel.app/api/proxy/groq/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"llama-3.3-70b-versatile","messages":[...]}'

# Google Gemini (via proxy)
curl "https://your-domain.vercel.app/api/proxy/google/v1beta/models/gemini-1.5-flash:generateContent" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'`}
                        </pre>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">Supported Providers</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {providers.map(p => (
                          <div key={p.id} className="p-2.5 rounded-xl border border-gray-200 bg-gray-50">
                            <div className="font-medium text-xs">{p.name}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{p.id}</div>
                            <div className="text-[10px] text-gray-400 mt-1 truncate">{p.baseUrl}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">Features</h4>
                      <ul className="text-xs text-gray-600 space-y-1.5 list-disc list-inside bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <li><strong>Key Rotation:</strong> Round-robin with least-used preference, automatic failover</li>
                        <li><strong>Rate Limit Handling:</strong> Detects 429, parses Retry-After, backs off per-key</li>
                        <li><strong>Streaming Support:</strong> Full support for SSE streaming (chat completions)</li>
                        <li><strong>Auth Errors:</strong> Marks keys invalid on 401/403, skips them automatically</li>
                        <li><strong>Encrypted Storage:</strong> AES-256-GCM encryption at rest</li>
                        <li><strong>Persistent:</strong> Uses Upstash Redis / Vercel KV if available, else file storage</li>
                        <li><strong>Zero Config Deploy:</strong> Works on Vercel with GitHub integration</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">Environment Variables</h4>
                      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 text-xs font-mono">
                        <div><span className="text-gray-500">ADMIN_PASSWORD</span>=your-secure-password <span className="text-gray-400"># Dashboard login</span></div>
                        <div><span className="text-gray-500">ENCRYPTION_KEY</span>=32-char-secret <span className="text-gray-400"># For key encryption</span></div>
                        <div><span className="text-gray-500">UPSTASH_REDIS_REST_URL</span> <span className="text-gray-400"># Auto if you add Redis integration</span></div>
                        <div><span className="text-gray-500">UPSTASH_REDIS_REST_TOKEN</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-black text-white rounded-2xl p-6">
                  <h3 className="font-semibold text-sm mb-3">Deploy to Vercel</h3>
                  <ol className="text-xs text-gray-300 space-y-2 list-decimal list-inside">
                    <li>Push this repo to GitHub</li>
                    <li>Import in Vercel dashboard (vercel.com/new)</li>
                    <li>Add environment variables: ADMIN_PASSWORD, ENCRYPTION_KEY</li>
                    <li>Optional: Add Upstash Redis integration for persistent storage (Marketplace → Redis)</li>
                    <li>Deploy - your router is live!</li>
                    <li>Add API keys via dashboard and start using proxy endpoints</li>
                  </ol>
                  <div className="mt-4 flex gap-2">
                    <a href="https://vercel.com/new" target="_blank" className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-medium">Deploy Now</a>
                    <a href="/api/health" target="_blank" className="px-3 py-1.5 rounded-full border border-white/20 text-white text-xs">Health Check</a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Key Modal */}
      {showAddKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md animate-slide-in">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold">Add API Key</h3>
              <button onClick={() => setShowAddKey(false)} className="p-1 rounded-full hover:bg-gray-100">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleAddKey} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-700">Key Name</label>
                <input
                  value={newKey.name}
                  onChange={e => setNewKey({ ...newKey, name: e.target.value })}
                  placeholder="e.g. Production Key 1"
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">Provider</label>
                <select
                  value={newKey.provider}
                  onChange={e => setNewKey({ ...newKey, provider: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">API Key</label>
                <input
                  type="password"
                  value={newKey.key}
                  onChange={e => setNewKey({ ...newKey, key: e.target.value })}
                  placeholder="sk-..."
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  required
                />
                <p className="text-[11px] text-gray-500 mt-1">Encrypted at rest with AES-256-GCM</p>
              </div>

              {(newKey.provider === "custom" || newKey.provider.startsWith("custom-")) && (
                <div>
                  <label className="text-xs font-medium text-gray-700">Custom Base URL</label>
                  <input
                    value={newKey.customBaseUrl}
                    onChange={e => setNewKey({ ...newKey, customBaseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    required
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-700">Notes (optional)</label>
                <input
                  value={newKey.notes}
                  onChange={e => setNewKey({ ...newKey, notes: e.target.value })}
                  placeholder="Usage, team, etc."
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAddKey(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-900">
                  Add Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="border-t border-gray-200 mt-12 py-6">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <div>AI Router • Multi-key rotation • Rate limit handling • Vercel Ready</div>
          <div className="flex items-center gap-3">
            <a href="/api/health" className="hover:text-black">Health</a>
            <span>•</span>
            <span>{stats?.overview.totalKeys || 0} keys • {stats?.stats.totalRequests || 0} requests</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
