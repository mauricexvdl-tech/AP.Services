"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type State, WagmiProvider } from "wagmi";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { base, baseSepolia } from "wagmi/chains";
import { http, createConfig } from "wagmi";

// Wagmi config for Base L2 networks
const config = createConfig({
    chains: [baseSepolia, base],
    transports: {
        [baseSepolia.id]: http(),
        [base.id]: http(),
    },
});

const queryClient = new QueryClient();

export function Providers({
    children,
    initialState,
}: {
    children: React.ReactNode;
    initialState?: State;
}) {
    return (
        <WagmiProvider config={config} initialState={initialState}>
            <QueryClientProvider client={queryClient}>
                <OnchainKitProvider
                    apiKey={process.env.NEXT_PUBLIC_ONCHAINKIT_API_KEY}
                    chain={baseSepolia} // Defaulting to Sepolia for MVP
                >
                    {children}
                </OnchainKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
