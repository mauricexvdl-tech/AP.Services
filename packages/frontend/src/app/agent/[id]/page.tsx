"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Terminal, ShieldAlert, Cpu, Power, ArrowLeft, Send, Activity, ShieldCheck, History } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

// Mock data
const AGENT = {
    id: "1",
    name: "Defi Arbitrage Bot",
    image: "docker.io/aporia/defi-arb:v1",
    tier: "LOGIC",
    status: "active",
    tbaAddress: "0x7F2a...39cA",
    balance: "0.25 ETH",
    uptime: "99.8%",
    lastHeartbeat: "12 seconds ago",
    insurancePolicy: "Active",
    insurancePremium: "0.01 ETH",
};

const SPACETIMEDB_URL = process.env.NEXT_PUBLIC_SPACETIMEDB_URL || "ws://localhost:3000";
const DATABASE_NAME = "aporia_memory";

interface LogEntry {
    time: string;
    role: string;
    msg: string;
}

export default function AgentDetailPage({ params }: { params: { id: string } }) {
    const { isConnected } = useAccount();
    const [isMounted, setIsMounted] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([
        { time: new Date().toLocaleTimeString('en-US', { hour12: false }), role: "system", msg: "[Memory] Connecting to SpaceTimeDB WebSocket..." }
    ]);
    const [wsConnected, setWsConnected] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // SpaceTimeDB WebSocket Subscription
    useEffect(() => {
        if (!isMounted) return;

        // SpaceTimeDB specific WebSocket endpoint
        const wsUrl = `${SPACETIMEDB_URL}/database/api/v1/subscribe/websocket/${DATABASE_NAME}`;
        console.log(`[SpaceTimeDB] Connecting to ${wsUrl}`);

        let ws: WebSocket;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("[SpaceTimeDB] Socket opened");
                setWsConnected(true);

                // Subscribe to the AgentState and ConversationHistory tables for this specific agent
                // Note: since id comes from the pathname params, we query where owner_address matches.
                // But in MVP we might just subscribe to all and filter client-side if the query language is complex.
                const subscribeQuery = `
                    SELECT * FROM ConversationHistory WHERE owner_address = '${params.id}';
                `;

                ws.send(JSON.stringify({
                    subscribe: {
                        query_strings: [subscribeQuery]
                    }
                }));

                setLogs(prev => [...prev.slice(-100), {
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    role: "system",
                    msg: `[Memory] Subscribed to memory stream for Agent ${params.id.substring(0, 6)}...`
                }]);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // SpaceTimeDB sends TableUpdate events
                    if (data.TransactionUpdate && data.TransactionUpdate.subscription_update) {
                        const updates = data.TransactionUpdate.subscription_update.table_updates;

                        for (const update of updates) {
                            if (update.table_name === "ConversationHistory") {
                                for (const row of update.table_row_operations) {
                                    if (row.op === "insert") {
                                        // Schema: owner_address(0), seq(1), role(2), content(3), timestamp(4)
                                        const rowData = row.row;
                                        setLogs(prev => {
                                            const newLogs = [...prev, {
                                                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                                                role: rowData[2],
                                                msg: rowData[3]
                                            }];
                                            return newLogs.slice(-50); // Keep last 50 messages
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("[SpaceTimeDB] Parse error", e);
                }
            };

            ws.onerror = (error) => {
                console.error("[SpaceTimeDB] Socket error", error);
                setLogs(prev => [...prev.slice(-100), {
                    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                    role: "system",
                    msg: `[Memory] Connection error. Is SpaceTimeDB running?`
                }]);
            };

            ws.onclose = () => {
                console.log("[SpaceTimeDB] Socket closed");
                setWsConnected(false);
            };

        } catch (e) {
            console.error("[SpaceTimeDB] Init error", e);
        }

        return () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    }, [isMounted, params.id]);

    const handleFund = () => {
        // Scaffold smart contract interaction
        alert("Trigger wagmi sendTransaction to TBA: " + AGENT.tbaAddress);
    };

    const handleTriggerRestart = () => {
        alert("Trigger AporiaAgentNFT.triggerRestart() transaction");
    };

    if (!isMounted) return null;

    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <h2 className="text-xl font-bold">Please connect your wallet first.</h2>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex items-center space-x-4 mb-4">
                <Link href="/">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        {AGENT.name}
                        <Badge variant="success" className="uppercase text-xs flex items-center gap-1.5 h-6">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                            {AGENT.status}
                        </Badge>
                    </h1>
                    <p className="text-muted-foreground font-mono text-sm mt-1">{AGENT.image}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column: Health & Treasury */}
                <div className="space-y-6 lg:col-span-1">
                    {/* Orchestration & Health */}
                    <Card className="bg-card/50 backdrop-blur">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Activity className="h-5 w-5 text-primary" />
                                Health & Orchestration
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Uptime SLA</p>
                                    <p className="font-medium text-xl">{AGENT.uptime}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Compute Tier</p>
                                    <p className="font-medium flex items-center gap-1.5">
                                        <Cpu className="h-4 w-4" /> {AGENT.tier}
                                    </p>
                                </div>
                            </div>

                            <div className="pt-3 border-t border-border/50">
                                <p className="text-xs text-muted-foreground mb-1">Last Heartbeat</p>
                                <p className="font-mono text-sm">{AGENT.lastHeartbeat}</p>
                            </div>

                            <div className="pt-3 border-t border-border/50">
                                <Button variant="outline" className="w-full text-xs" onClick={handleTriggerRestart}>
                                    <Power className="h-3.5 w-3.5 mr-2 text-yellow-500" />
                                    Force Manual Restart
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Treasury & TBA */}
                    <Card className="bg-card/50 backdrop-blur border-primary/20">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-primary" />
                                ERC-6551 Treasury
                            </CardTitle>
                            <CardDescription>Token Bound Account Wallet</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-background/80 p-3 rounded-md">
                                <p className="text-xs text-muted-foreground mb-1">TBA Address</p>
                                <p className="font-mono text-sm break-all">{AGENT.tbaAddress}</p>
                            </div>

                            <div className="flex justify-between items-end">
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Operational Funds</p>
                                    <p className="text-2xl font-bold font-mono text-primary">{AGENT.balance}</p>
                                </div>
                            </div>

                            <Button className="w-full mt-2" onClick={handleFund}>
                                <Send className="h-4 w-4 mr-2" />
                                Fund TBA
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Insurance Vault */}
                    <Card className="bg-card/50 backdrop-blur">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ShieldAlert className="h-5 w-5 text-primary" />
                                Insurance Vault
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Status</span>
                                <Badge variant="outline" className="text-green-500 border-green-500/20">{AGENT.insurancePolicy}</Badge>
                            </div>
                            <div className="flex justify-between items-center text-sm mt-3">
                                <span className="text-muted-foreground">Premium Locked</span>
                                <span className="font-mono">{AGENT.insurancePremium}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: SpaceTimeDB Memory Terminal */}
                <div className="lg:col-span-2">
                    <Card className="h-full flex flex-col bg-background/95 border-primary/30 shadow-lg shadow-primary/5">
                        <CardHeader className="border-b border-border/50 pb-4 bg-card/30">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Terminal className="h-5 w-5 text-primary" />
                                SpaceTimeDB Memory
                                <Badge variant={wsConnected ? "success" : "destructive"} className="ml-2 font-mono text-[10px] bg-background">
                                    {wsConnected ? "Live Connected" : "Offline"}
                                </Badge>
                            </CardTitle>
                            <CardDescription>
                                Real-time hot state and interaction history synced from WASM modules.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 overflow-hidden relative">
                            <div className="absolute inset-0 p-4 overflow-y-auto font-mono text-sm leading-relaxed space-y-3">
                                {logs.map((log, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className={`flex gap-3 ${log.role === 'system' ? 'text-muted-foreground' : 'text-foreground'}`}
                                    >
                                        <span className="text-primary/60 shrink-0 select-none">[{log.time}]</span>
                                        <span className="break-words">
                                            {log.role === 'agent' && <span className="text-blue-400 mr-2">➜</span>}
                                            {log.msg}
                                        </span>
                                    </motion.div>
                                ))}

                                {/* Blinking cursor effect */}
                                <div className="flex gap-3 text-muted-foreground animate-pulse">
                                    <span className="text-primary/60">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span>
                                    <span className="w-2 h-4 bg-primary inline-block opacity-70"></span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

            </div>
        </div>
    );
}
