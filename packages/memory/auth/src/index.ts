import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Load environment variables
const PORT = process.env.PORT || 4000;
const SPACETIMEDB_URL = process.env.SPACETIMEDB_URL || "http://localhost:3000";
const SPACETIMEDB_DB = process.env.SPACETIMEDB_DB || "aporia_memory";
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const NFT_CONTRACT_ADDRESS = process.env.APORIA_NFT_ADDRESS || "";

// Minimal ABI to verify NFT ownership
const NFT_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function getTBA(uint256 tokenId) view returns (address)"
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

/**
 * Middleware: Verify ERC-6551 EIP-191 Signature
 * 
 * Flow:
 * 1. Client sends message structured as: `AporiaAgentAuth:<tokenId>:<timestamp>`
 * 2. Client sends signature of this message using the agent owner's private key
 * 3. Bridge recovers the signer address
 * 4. Bridge checks on-chain if the signer is the current owner of `tokenId`
 */
async function verifyAgentSignature(req: Request, res: Response, next: NextFunction) {
    try {
        const { tokenId, timestamp, signature } = req.headers;

        if (!tokenId || !timestamp || !signature) {
            return res.status(401).json({ error: "Missing authentication headers" });
        }

        const timeDiff = Math.abs(Date.now() - parseInt(timestamp as string));
        if (timeDiff > 5 * 60 * 1000) { // 5 minute expiry
            return res.status(401).json({ error: "Signature expired" });
        }

        // Reconstruct the message that was signed
        const message = `AporiaAgentAuth:${tokenId}:${timestamp}`;

        // Recover signer address from signature
        const signerAddress = ethers.verifyMessage(message, signature as string);

        // Verify on-chain ownership
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, provider);
        const owner = await nftContract.ownerOf(tokenId);

        if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
            return res.status(403).json({ error: "Forbidden: Signer does not own this agent" });
        }

        // Attach verified TBA address to request
        const tbaAddress = await nftContract.getTBA(tokenId);
        (req as any).agentTba = tbaAddress.toLowerCase();

        next();
    } catch (error: any) {
        console.error("Auth verify failed:", error.message);
        res.status(500).json({ error: "Internal signature verification error" });
    }
}

// ─── Routes ──────────────────────────────────────────────────────────

/**
 * Write Agent State (Hot Memory)
 */
app.post("/memory/state", verifyAgentSignature, async (req, res) => {
    const { key, value } = req.body;
    const owner_address = (req as any).agentTba;

    try {
        // In production, this would use the spacetimedb-sdk.
        // Since SpaceTimeDB exposes a REST API for reducers too, we can bridge it directly.
        const response = await fetch(`${SPACETIMEDB_URL}/database/${SPACETIMEDB_DB}/call/write_state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([owner_address, key, value])
        });

        if (!response.ok) throw new Error(await response.text());
        res.json({ success: true });
    } catch (error: any) {
        res.status(502).json({ error: `SpaceTimeDB error: ${error.message}` });
    }
});

/**
 * Append Conversation History
 */
app.post("/memory/chat", verifyAgentSignature, async (req, res) => {
    const { role, content } = req.body;
    const owner_address = (req as any).agentTba;

    try {
        const response = await fetch(`${SPACETIMEDB_URL}/database/${SPACETIMEDB_DB}/call/append_message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([owner_address, role, content])
        });

        if (!response.ok) throw new Error(await response.text());
        res.json({ success: true });
    } catch (error: any) {
        res.status(502).json({ error: `SpaceTimeDB error: ${error.message}` });
    }
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
    res.json({ status: "Auth Bridge Operational" });
});

app.listen(PORT, () => {
    console.log(`[Auth Bridge] Listening on port ${PORT}`);
    console.log(`[Auth Bridge] Upstream SpaceTimeDB: ${SPACETIMEDB_URL}`);
});
