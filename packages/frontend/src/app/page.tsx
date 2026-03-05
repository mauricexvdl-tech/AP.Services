"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Power, Wallet as WalletIcon, Cpu } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useReadContract, useReadContracts, useBalance } from "wagmi";
import { APORIA_AGENT_NFT_ADDRESS, APORIA_AGENT_NFT_ABI } from "@/lib/contracts";

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

      <AgentGrid />
    </div>
  );
}

function AgentGrid() {
  // 1. Get total supply
  const { data: totalSupplyRaw, error: supplyError } = useReadContract({
    address: APORIA_AGENT_NFT_ADDRESS as `0x${string}`,
    abi: APORIA_AGENT_NFT_ABI,
    functionName: 'totalSupply',
  });
  const totalSupply = totalSupplyRaw ? Number(totalSupplyRaw) : 0;

  // 2. Prep calls for tokens
  const tokenIds = Array.from({ length: totalSupply }, (_, i) => BigInt(i));

  const { data: tokensData, error: tokensError } = useReadContracts({
    contracts: tokenIds.flatMap(id => [
      {
        address: APORIA_AGENT_NFT_ADDRESS as `0x${string}`,
        abi: APORIA_AGENT_NFT_ABI,
        functionName: 'agents',
        args: [id]
      },
      {
        address: APORIA_AGENT_NFT_ADDRESS as `0x${string}`,
        abi: APORIA_AGENT_NFT_ABI,
        functionName: 'getTBA',
        args: [id]
      },
      {
        address: APORIA_AGENT_NFT_ADDRESS as `0x${string}`,
        abi: APORIA_AGENT_NFT_ABI,
        functionName: 'ownerOf',
        args: [id]
      }
    ])
  });

  const agents: any[] = [];

  if (tokensData) {
    for (let i = 0; i < totalSupply; i++) {
      const agentsRes = tokensData[i * 3];
      const tbaRes = tokensData[i * 3 + 1];
      const ownerRes = tokensData[i * 3 + 2];

      if (agentsRes.status === "success" && tbaRes.status === "success" && ownerRes.status === "success") {
        const agentData = agentsRes.result as any;

        // Note: Tier 0=NANO, 1=LOGIC, 2=EXPERT
        const tierCode = agentData[3];
        const tierStr = tierCode === 0 ? "NANO" : tierCode === 1 ? "LOGIC" : "EXPERT";

        agents.push({
          id: tokenIds[i].toString(),
          owner: (ownerRes.result as unknown) as string,
          image: agentData[0], // imageURI
          tier: tierStr,
          isActive: agentData[5],
          tbaAddress: (tbaRes.result as unknown) as string
        });
      }
    }
  }

  useEffect(() => {
    console.log("WAGMI DASHBOARD DEBUG:");
    console.log("- Total Supply Raw:", totalSupplyRaw);
    console.log("- Supply Error:", supplyError);
    console.log("- Tokens Error:", tokensError);
    console.log("- Parsed Agents array:", agents);
  }, [totalSupplyRaw, supplyError, tokensError, agents.length]);

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent, i) => (
        <AgentCard key={agent.id} agent={agent} index={i} />
      ))}
      {/* Deploy New Agent Tile */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: agents.length * 0.1 }}
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
  );
}

function AgentCard({ agent, index }: { agent: any, index: number }) {
  const { data: balanceData } = useBalance({ address: agent.tbaAddress as `0x${string}` });
  const formattedBalance = balanceData ? `${Number(balanceData.formatted).toFixed(4)} ETH` : "0.0000 ETH";

  // Default name fallback since generic agent metadata doesn't enforce a name string globally
  const agentName = `Agent #${agent.id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="flex flex-col h-full bg-card/50 backdrop-blur border-border/50 hover:border-primary/50 transition-all">
        <CardHeader className="pb-4">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl">{agentName}</CardTitle>
              <CardDescription className="font-mono mt-1 text-xs truncate w-48">
                {agent.image}
              </CardDescription>
            </div>
            <Badge
              variant={agent.isActive ? 'success' : 'destructive'}
              className="flex items-center gap-1.5 uppercase"
            >
              {agent.isActive && <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
              {!agent.isActive && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
              {agent.isActive ? 'active' : 'dead'}
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
              <p className="font-medium font-mono">{formattedBalance}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-1">TBA Address</p>
            <div className="bg-background/80 p-2 rounded-md font-mono text-xs flex justify-between items-center">
              <span className="text-muted-foreground">{agent.tbaAddress.substring(0, 8)}...{agent.tbaAddress.substring(36)}</span>
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
  );
}
