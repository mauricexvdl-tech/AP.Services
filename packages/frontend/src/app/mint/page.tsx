"use client";

import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Terminal, ShieldAlert, Cpu, Power, ArrowLeft, Send, Activity, ShieldCheck, History } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useChainId } from "wagmi";
import { parseEther } from "viem";
import { APORIA_AGENT_NFT_ADDRESS, APORIA_AGENT_NFT_ABI } from "@/lib/contracts";
import { baseSepolia } from "wagmi/chains";

export default function MintAgentPage() {
    const { isConnected } = useAccount();
    const [isMounted, setIsMounted] = useState(false);
    const [step, setStep] = useState(1);

    useEffect(() => {
        setIsMounted(true);
    }, []);
    const [isMinting, setIsMinting] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [imageUri, setImageUri] = useState("docker.io/aporia/my-bot:latest");
    const [tier, setTier] = useState("NANO");
    const [envKeys, setEnvKeys] = useState("");
    const [envValues, setEnvValues] = useState("");
    const [escrowAmount, setEscrowAmount] = useState("0.05");

    const { writeContractAsync, data: hash, error: writeError } = useWriteContract();
    const { isLoading: isWaiting, isSuccess } = useWaitForTransactionReceipt({ hash });

    // Switch chain logic
    const chainId = useChainId();
    const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

    useEffect(() => {
        if (isSuccess) {
            window.location.href = "/";
        }
    }, [isSuccess]);

    const handleMint = async () => {
        setIsMinting(true);
        try {
            if (chainId !== baseSepolia.id) {
                console.log("Switching chain to Base Sepolia...");
                await switchChainAsync({ chainId: baseSepolia.id });
                // We'll let the user click again after switching to avoid race conditions
                setIsMinting(false);
                return;
            }

            // Note: NANO=0, LOGIC=1, EXPERT=2
            const tierMapping: Record<string, number> = { NANO: 0, LOGIC: 1, EXPERT: 2 };

            // Dummy encryption for PoC - in prod this uses NaCL
            const dummyEncryptedEnv = `0x${Buffer.from(envValues).toString('hex')}`;

            await writeContractAsync({
                address: APORIA_AGENT_NFT_ADDRESS as `0x${string}`,
                abi: APORIA_AGENT_NFT_ABI,
                functionName: 'registerAgent',
                args: [
                    imageUri,
                    dummyEncryptedEnv as `0x${string}`,
                    tierMapping[tier]
                ],
                value: parseEther(escrowAmount)
            });
            // Transaction submitted, waiting will trigger useEffect
        } catch (error) {
            console.error(error);
            setIsMinting(false);
        }
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
        <div className="max-w-3xl mx-auto space-y-8">
            <div className="flex items-center space-x-4 mb-2">
                <Link href="/">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Deploy Sovereign Agent</h1>
                    <p className="text-muted-foreground mt-1">
                        Mint an ERC-721 identity and provision its Token Bound Account.
                    </p>
                </div>
            </div>

            {/* Progress Steps */}
            <div className="flex justify-between items-center mb-8 px-4">
                {[1, 2, 3, 4].map((s) => (
                    <div key={s} className="flex flex-col items-center">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold ${step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            } transition-colors`}>
                            {s}
                        </div>
                        <span className="text-xs mt-2 text-muted-foreground font-medium">
                            {s === 1 ? "Profile" : s === 2 ? "Compute" : s === 3 ? "Secrets" : "Deploy"}
                        </span>
                    </div>
                ))}
            </div>

            <Card className="bg-card/50 backdrop-blur border-border/60">
                <CardHeader>
                    <CardTitle>
                        {step === 1 && "Basic Information"}
                        {step === 2 && "Akash Compute Tier"}
                        {step === 3 && "Environment & Secrets"}
                        {step === 4 && "Review & Mint"}
                    </CardTitle>
                    <CardDescription>
                        {step === 1 && "Give your AI agent an identity and Docker image."}
                        {step === 2 && "Select the hardware resources your agent requires."}
                        {step === 3 && "Client-side encrypted environment variables."}
                        {step === 4 && "Approve transaction to generate Token Bound Account."}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    {step === 1 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Agent Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="e.g. DeFi Arb Bot"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Docker Image URI</label>
                                <input
                                    type="text"
                                    value={imageUri}
                                    onChange={(e) => setImageUri(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="docker.io/username/repo:tag"
                                />
                            </div>
                        </motion.div>
                    )}

                    {step === 2 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="grid gap-4 md:grid-cols-3">
                            {[
                                { id: "NANO", cpu: "1 vCPU", ram: "1 GB", price: "~$2/mo" },
                                { id: "LOGIC", cpu: "2 vCPU", ram: "4 GB", price: "~$5/mo" },
                                { id: "EXPERT", cpu: "4 vCPU", ram: "16 GB", price: "~$10/mo" }
                            ].map((t) => (
                                <div
                                    key={t.id}
                                    onClick={() => setTier(t.id)}
                                    className={`border rounded-lg p-4 cursor-pointer transition-all ${tier === t.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50 bg-background/50'
                                        }`}
                                >
                                    <Cpu className={`h-6 w-6 mb-3 ${tier === t.id ? 'text-primary' : 'text-muted-foreground'}`} />
                                    <h3 className="font-bold text-lg mb-1">{t.id}</h3>
                                    <div className="space-y-1 text-sm text-muted-foreground mb-4">
                                        <p>{t.cpu}</p>
                                        <p>{t.ram}</p>
                                    </div>
                                    <Badge variant={tier === t.id ? 'default' : 'secondary'}>{t.price}</Badge>
                                </div>
                            ))}
                        </motion.div>
                    )}

                    {step === 3 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                            <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 p-4 rounded-md flex items-start gap-3 text-sm">
                                <ShieldAlert className="h-5 w-5 shrink-0" />
                                <p>
                                    Secrets are <b>asymmetrically encrypted directly in your browser using NaCL</b> before touching the blockchain.
                                    APORIA nodes can only decrypt these in secured enclaves just-in-time for deployment.
                                </p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 mt-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">API Key (Name)</label>
                                    <input
                                        type="text"
                                        value={envKeys}
                                        onChange={(e) => setEnvKeys(e.target.value)}
                                        className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm font-mono ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        placeholder="e.g. OPENAI_API_KEY"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Value (Secret)</label>
                                    <input
                                        type="password"
                                        value={envValues}
                                        onChange={(e) => setEnvValues(e.target.value)}
                                        className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm font-mono ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        placeholder="sk-..."
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 4 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="rounded-lg border bg-background/50 p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-y-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground mb-1">Agent Name</p>
                                        <p className="font-medium">{name || "Unnamed Agent"}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-1">Compute Tier</p>
                                        <p className="font-medium flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> {tier}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-muted-foreground mb-1">Docker Image</p>
                                        <p className="font-mono bg-card p-2 rounded text-xs select-all border">{imageUri}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-primary/10 border border-primary/20 p-4 rounded-md">
                                <h4 className="font-medium text-primary mb-2 flex items-center gap-2">
                                    <Activity className="h-4 w-4" /> Recommended Escrow
                                </h4>
                                <p className="text-sm text-foreground/80 mb-3">
                                    Agents require operational funds in their Token Bound Account to pay for compute leases.
                                </p>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={escrowAmount}
                                        onChange={(e) => setEscrowAmount(e.target.value)}
                                        className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                    <span className="font-bold">ETH</span>
                                </div>
                                {writeError && (
                                    <p className="text-red-500 text-xs mt-3">{writeError.message.split("\\n")[0]}</p>
                                )}
                            </div>
                        </motion.div>
                    )}
                </CardContent>

                <CardFooter className="flex justify-between border-t border-border/50 pt-6">
                    <Button
                        variant="outline"
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1 || isMinting}
                    >
                        Back
                    </Button>

                    {step < 4 ? (
                        <Button onClick={() => setStep(s => Math.min(4, s + 1))}>
                            Continue
                        </Button>
                    ) : (
                        <Button
                            size="lg"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground relative overflow-hidden group"
                            onClick={handleMint}
                            disabled={isMinting || isWaiting || isSwitching}
                        >
                            {(isMinting || isWaiting || isSwitching) ? (
                                <>
                                    <Activity className="mr-2 h-4 w-4 animate-spin" /> {isSwitching ? "Switching Network..." : (isWaiting ? "Confirming..." : "Sign in Wallet...")}
                                </>
                            ) : chainId !== baseSepolia.id ? (
                                <>
                                    <ShieldAlert className="mr-2 h-4 w-4" /> Switch to Base Sepolia
                                </>
                            ) : (
                                <>
                                    <Power className="mr-2 h-4 w-4" /> Mint & Deploy Agent
                                </>
                            )}
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
