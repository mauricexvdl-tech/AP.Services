"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Power, Wallet as WalletIcon, Cpu } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

// Mock data until we plug in the wagmi reads
const MOCK_AGENTS = [
  {
    id: "1",
    name: "Defi Arbitrage Bot",
    image: "docker.io/aporia/defi-arb:v1",
    tier: "LOGIC",
    status: "active",
    tbaAddress: "0x7F2a...39cA",
    balance: "0.25 ETH"
  },
  {
    id: "2",
    name: "Social Media Sentience",
    image: "docker.io/aporia/sentiment:latest",
    tier: "NANO",
    status: "dead",
    tbaAddress: "0x1A4b...99dF",
    balance: "0.001 ETH"
  },
  {
    id: "3",
    name: "DAO Treasury Manager",
    image: "docker.io/aporia/governance:v3",
    tier: "EXPERT",
    status: "resurrecting",
    tbaAddress: "0x88cE...22bA",
    balance: "1.5 ACT"
  }
];

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
        <div className="p-4 rounded-full bg-primary/10 text-primary mb-4">
          <Power className="h-12 w-12" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Connect to APORIA</h1>
        <p className="text-muted-foreground max-w-md text-lg">
          Connect your Base L2 wallet to seamlessly manage your autonomous economic agents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Agent Command Center</h1>
        <p className="text-muted-foreground mt-2">
          Manage your sovereign AI agents and Token Bound Accounts (TBAs).
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {MOCK_AGENTS.map((agent, i) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="flex flex-col h-full bg-card/50 backdrop-blur border-border/50 hover:border-primary/50 transition-all">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl">{agent.name}</CardTitle>
                    <CardDescription className="font-mono mt-1 text-xs truncate w-48">
                      {agent.image}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      agent.status === 'active' ? 'success' :
                        agent.status === 'resurrecting' ? 'warning' : 'destructive'
                    }
                    className="flex items-center gap-1.5 uppercase"
                  >
                    {agent.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
                    {agent.status === 'resurrecting' && <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />}
                    {agent.status === 'dead' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                    {agent.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5" /> Tier
                    </p>
                    <p className="font-medium">{agent.tier}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1.5">
                      <WalletIcon className="h-3.5 w-3.5" /> Balance
                    </p>
                    <p className="font-medium font-mono">{agent.balance}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-1">TBA Address</p>
                  <div className="bg-background/80 p-2 rounded-md font-mono text-xs flex justify-between items-center">
                    <span className="text-muted-foreground">{agent.tbaAddress}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Link href={`/agent/${agent.id}`} className="w-full">
                  <Button variant="secondary" className="w-full group">
                    <Activity className="h-4 w-4 mr-2 group-hover:text-primary transition-colors" />
                    Manage Agent
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          </motion.div>
        ))}

        {/* Deploy New Agent Tile */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: MOCK_AGENTS.length * 0.1 }}
        >
          <Link href="/mint">
            <Card className="flex flex-col h-full bg-background/30 border-dashed border-2 hover:border-primary/50 hover:bg-background/50 transition-all cursor-pointer items-center justify-center text-center p-6 min-h-[300px]">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                <Power className="h-6 w-6" />
              </div>
              <CardTitle className="mb-2">Deploy New Agent</CardTitle>
              <CardDescription>
                Mint a sovereign ERC-6551 bot and provide initial escrow.
              </CardDescription>
            </Card>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
