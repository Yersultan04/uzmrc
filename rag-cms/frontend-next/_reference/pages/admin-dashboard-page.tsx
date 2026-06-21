"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Plug, Wrench, AlertTriangle, Clock, CheckCircle, TrendingUp, XCircle, ThumbsUp, ThumbsDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminApi } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

interface ToolStat {
  name: string;
  count: number;
}

interface ErrorStat {
  name: string;
  error_count: number;
  error_pct: number;
}

interface AdminChange {
  who: string;
  what: string;
  at: string;
}

interface UnhealthyServer {
  id: string;
  name: string;
}

interface AgentFeedbackStat {
  agent_id: string;
  agent_label: string;
  total: number;
  positive: number;
  negative: number;
  accuracy_pct: number;
}

interface FeedbackStats {
  overall: {
    total: number;
    positive: number;
    negative: number;
    accuracy_pct: number;
  };
  by_agent: AgentFeedbackStat[];
}

interface Metrics {
  pending_hitl: number;
  unhealthy_servers: UnhealthyServer[];
  top_tools_24h: ToolStat[];
  top_errors_24h: ErrorStat[];
  recent_admin_changes: AdminChange[];
  total_enabled_servers: number;
  total_tools: number;
  total_users: number;
  feedback_stats?: FeedbackStats;
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getMetrics()
      .then((data: Metrics) => setMetrics(data))
      .catch(() => setMetrics(null))
      .finally(() => setLoading(false));
  }, []);

  const skeleton = (
    <div className="animate-pulse h-6 bg-slate-200 rounded w-16" />
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Platform overview and management</p>
      </div>

      {/* Row 1: HITL + Unhealthy Servers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        {/* Pending HITL */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
                <Clock size={15} className="text-amber-500" />
                Pending HITL Approvals
              </CardTitle>
              {!loading && metrics && metrics.pending_hitl > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {metrics.pending_hitl}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? skeleton : (
              <div className="flex items-center justify-between">
                <p className="text-3xl font-bold text-gray-900">
                  {metrics?.pending_hitl ?? 0}
                </p>
                <Link
                  href="/admin/approvals"
                  className="text-xs font-medium text-green-700 hover:underline border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-50 transition-colors"
                >
                  Review →
                </Link>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">Waiting for admin decision</p>
          </CardContent>
        </Card>

        {/* Unhealthy Servers */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" />
              Server Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? skeleton : metrics?.unhealthy_servers && metrics.unhealthy_servers.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-red-600 mb-2">
                  {metrics.unhealthy_servers.length} unhealthy server(s)
                </p>
                {metrics.unhealthy_servers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                    <span className="text-xs font-medium text-red-700">{s.name}</span>
                    <Link
                      href={`/admin/mcp-servers/${s.id}`}
                      className="text-xs text-red-600 hover:underline font-medium"
                    >
                      Test →
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle size={18} className="text-green-500" />
                <p className="text-sm text-gray-600 font-medium">All servers healthy</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Top Tools + Top Errors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        {/* Top 5 tools 24h */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <TrendingUp size={15} className="text-blue-500" />
              Top 5 Tools (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse h-5 bg-slate-200 rounded" />
              ))}</div>
            ) : !metrics?.top_tools_24h?.length ? (
              <p className="text-xs text-gray-400 italic">No tool invocations in the last 24h</p>
            ) : (
              <div className="space-y-2">
                {metrics.top_tools_24h.map((t, idx) => {
                  const maxCount = metrics.top_tools_24h[0]?.count || 1;
                  const pct = Math.round((t.count / maxCount) * 100);
                  return (
                    <div key={t.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-4">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-mono text-gray-700 truncate">{t.name}</span>
                          <Badge variant="secondary" className="text-xs ml-2 shrink-0">{t.count}</Badge>
                        </div>
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: "#006B54" }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top 5 errors */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <XCircle size={15} className="text-red-500" />
              Top 5 Errors (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse h-5 bg-slate-200 rounded" />
              ))}</div>
            ) : !metrics?.top_errors_24h?.length ? (
              <p className="text-xs text-gray-400 italic">No errors in the last 24h</p>
            ) : (
              <div className="space-y-2">
                {metrics.top_errors_24h.map((e, idx) => (
                  <div key={e.name} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-4">{idx + 1}</span>
                    <span className="text-xs font-mono text-gray-700 flex-1 truncate">{e.name}</span>
                    <span className="text-xs font-semibold text-red-600 shrink-0">
                      {e.error_count} ({e.error_pct.toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row: RAG Accuracy */}
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
          <ThumbsUp size={14} className="text-green-500" />
          RAG Accuracy
          <span className="font-normal text-gray-400">(based on user feedback)</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Overall */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Overall</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? skeleton : !metrics?.feedback_stats || metrics.feedback_stats.overall.total === 0 ? (
                <p className="text-xs text-gray-400 italic">No feedback yet</p>
              ) : (
                <>
                  <p className={`text-3xl font-bold ${
                    metrics.feedback_stats.overall.accuracy_pct >= 70
                      ? "text-green-600"
                      : metrics.feedback_stats.overall.accuracy_pct >= 40
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}>
                    {metrics.feedback_stats.overall.accuracy_pct.toFixed(1)}%
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <ThumbsUp size={11} />
                      {metrics.feedback_stats.overall.positive}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      <ThumbsDown size={11} />
                      {metrics.feedback_stats.overall.negative}
                    </span>
                    <span className="text-xs text-gray-400">
                      / {metrics.feedback_stats.overall.total} rated
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Per-agent */}
          {!loading && metrics?.feedback_stats?.by_agent.map((agent) => (
            <Card key={agent.agent_id} className="border-gray-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">{agent.agent_label}</CardTitle>
              </CardHeader>
              <CardContent>
                {agent.total === 0 ? (
                  <p className="text-xs text-gray-400 italic">No feedback yet</p>
                ) : (
                  <>
                    <p className={`text-3xl font-bold ${
                      agent.accuracy_pct >= 70
                        ? "text-green-600"
                        : agent.accuracy_pct >= 40
                        ? "text-yellow-600"
                        : "text-red-600"
                    }`}>
                      {agent.accuracy_pct.toFixed(1)}%
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <ThumbsUp size={11} />
                        {agent.positive}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <ThumbsDown size={11} />
                        {agent.negative}
                      </span>
                      <span className="text-xs text-gray-400">
                        / {agent.total} rated
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Row 3: Recent Changes + System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Recent Admin Changes */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Recent Admin Changes</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse h-5 bg-slate-200 rounded" />
              ))}</div>
            ) : !metrics?.recent_admin_changes?.length ? (
              <p className="text-xs text-gray-400 italic">No recent admin changes</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.recent_admin_changes.map((c, idx) => (
                  <div key={idx} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-gray-700">{c.who}</span>
                        <span className="text-xs text-gray-500 ml-1">{c.what}</span>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {c.at ? formatDistanceToNow(new Date(c.at), { addSuffix: true }) : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Status */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
                  style={{ backgroundColor: "#ecfdf5" }}
                >
                  <Plug size={16} style={{ color: "#059669" }} />
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {loading ? "—" : metrics?.total_enabled_servers ?? "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Servers</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
                  style={{ backgroundColor: "#eff6ff" }}
                >
                  <Wrench size={16} style={{ color: "#2563eb" }} />
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {loading ? "—" : metrics?.total_tools ?? "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Tools</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
                  style={{ backgroundColor: "var(--brand-50, #f0fdf4)" }}
                >
                  <Users size={16} style={{ color: "var(--brand-600, #006B54)" }} />
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {loading ? "—" : metrics?.total_users ?? "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card className="border-gray-200 shadow-sm mt-5">
        <CardHeader>
          <CardTitle className="text-base text-gray-900">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3">
            <Link
              href="/admin/users"
              className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 transition-all group hover:border-green-200 hover:bg-green-50"
            >
              <Users size={18} className="text-gray-400 group-hover:text-green-700 transition-colors" />
              <div>
                <p className="text-sm font-medium text-gray-700">Manage Users</p>
                <p className="text-xs text-gray-400">Add, edit, deactivate staff</p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
